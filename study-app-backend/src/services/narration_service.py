"""Narration clip cache: lesson audio generated ahead of time, stored low-bitrate in Postgres.

Playback asks for a chunk of text; if its clip is already stored it is a database read
(instant), otherwise the clip is generated, stored and returned. When a lesson's narration
script is written, `pregenerate_lesson` fills the cache in the background so the first
listener never waits. Clips are keyed by (voice, hash of the exact text), so an edited lesson
regenerates only the chunks that changed.
"""
import asyncio
import hashlib
import io
import json
import re
from typing import Optional

import soundfile as sf
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import async_session_maker
from src.models.learning_module import LearningModule
from src.models.narration_clip import NarrationClip
from src.services.speech_service import SpeechService
from src.utils.lesson_blocks import split_lesson_blocks
from src.utils.logger import get_logger
from src.utils.speech_text import markdown_to_speech, notation_to_speech, split_for_speech

logger = get_logger(__name__)

LESSON_VOICE = "af_heart"
EXPERT_VOICE = "bm_george"
# Mono at the provider's own sample rate, about 44 kbps (roughly 2 MB for a typical lesson, a third
# of the provider's 128 kbps). Down-sampling to 16 kHz was smaller but cut the high frequencies
# and made the voice sound tinny, so the rate is never changed.
STORED_COMPRESSION = 0.9
CHUNK_CHARS = 600
# Two clips at a time keeps a long lesson quick without hammering the provider.
PREGEN_CONCURRENCY = 2


def clip_hash(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def compress(audio: bytes) -> tuple[bytes, str]:
    """Re-encode provider mp3 as mono ~44 kbps mp3 at the same sample rate. Falls back to the original bytes."""
    try:
        data, rate = sf.read(io.BytesIO(audio), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        if len(data) == 0:
            return audio, "audio/mpeg"
        out = io.BytesIO()
        sf.write(out, data, rate, format="MP3", subtype="MPEG_LAYER_III", compression_level=STORED_COMPRESSION)
        small = out.getvalue()
        return (small, "audio/mpeg") if small and len(small) < len(audio) else (audio, "audio/mpeg")
    except Exception as exc:  # never lose a clip over re-encoding
        logger.warning("narration compress failed, storing the original: %s", exc)
        return audio, "audio/mpeg"


async def get_clip(session: AsyncSession, voice: str, text: str) -> Optional[NarrationClip]:
    return (
        await session.execute(
            select(NarrationClip).where(NarrationClip.voice == voice, NarrationClip.text_hash == clip_hash(text))
        )
    ).scalar_one_or_none()


async def ensure_clip(session: AsyncSession, voice: str, text: str) -> NarrationClip:
    """The stored clip, generating and storing it first if it does not exist."""
    existing = await get_clip(session, voice, text)
    if existing is not None:
        return existing
    # Encoding is CPU work, so it runs off the event loop.
    audio, content_type = await asyncio.to_thread(compress, await SpeechService().synthesize(text, voice))
    clip = NarrationClip(
        voice=voice, text_hash=clip_hash(text), audio=audio, content_type=content_type, size_bytes=len(audio)
    )
    session.add(clip)
    try:
        await session.commit()
    except IntegrityError:
        # Someone stored the same clip a moment ago; use theirs.
        await session.rollback()
        existing = await get_clip(session, voice, text)
        if existing is None:
            raise
        return existing
    return clip


def lesson_chunks(tts_script: str, lesson_content: str) -> list[str]:
    """The chunk texts the lesson player will request, mirroring mapScriptToBlocks in
    LearningModuleLesson.tsx. A list script with one entry per lesson block is spoken entry by
    entry; any other script is re-split into paragraphs. (The page can still differ when its
    display repair changes the block count; the player then generates those clips on demand.)"""
    entries: Optional[list[str]] = None
    if tts_script.lstrip().startswith("["):
        try:
            parsed = json.loads(tts_script)
            if isinstance(parsed, list):
                entries = [e if isinstance(e, str) else "" for e in parsed]
        except ValueError:
            entries = None
    if entries is not None and len(entries) == len(split_lesson_blocks(lesson_content or "")):
        paragraphs = [markdown_to_speech(e) for e in entries]
    else:
        source = "\n\n".join(entries) if entries is not None else tts_script
        by_blank = re.split(r"\n\s*\n", source)
        parts = by_blank if len(by_blank) > 1 else source.split("\n")
        paragraphs = [markdown_to_speech(p) for p in parts]
    return [chunk for paragraph in paragraphs if paragraph for chunk in split_for_speech(paragraph, CHUNK_CHARS)]


def episode_clips(turns: list, track_format: str) -> list[tuple[str, str]]:
    """(voice, chunk text) for every chunk the episode player will request: the host and lecturer
    speak with the lesson voice, the expert with the second voice (see castFor in episodeSpeech.ts)."""
    clips: list[tuple[str, str]] = []
    for turn in turns:
        if not isinstance(turn, dict):
            continue
        voice = EXPERT_VOICE if track_format == "podcast" and turn.get("speaker") == "expert" else LESSON_VOICE
        for chunk in split_for_speech(notation_to_speech(str(turn.get("text") or "")), CHUNK_CHARS):
            clips.append((voice, chunk))
    return clips


async def pregenerate_texts(texts: list[str], voice: str = LESSON_VOICE) -> None:
    """Generate any missing clips for `texts` with one voice."""
    await pregenerate_clips([(voice, t) for t in texts])


async def pregenerate_clips(clips: list[tuple[str, str]]) -> None:
    """Generate any missing (voice, text) clips, a couple at a time, each in its own session."""
    gate = asyncio.Semaphore(PREGEN_CONCURRENCY)

    async def one(voice: str, text: str) -> None:
        async with gate:
            try:
                async with async_session_maker() as session:
                    await ensure_clip(session, voice, text)
            except Exception as exc:  # a failed clip is just generated on demand later
                logger.warning("narration pregenerate failed for a clip: %s", exc)

    await asyncio.gather(*(one(v, t) for v, t in dict.fromkeys(clips)))


_background: set[asyncio.Task] = set()


def schedule_lesson_narration(module_id: int) -> None:
    """Start narrating a module's script in the background. Safe to call from any request;
    does nothing outside a running event loop."""
    try:
        task = asyncio.get_running_loop().create_task(pregenerate_lesson(module_id))
    except RuntimeError:
        return
    _background.add(task)
    task.add_done_callback(_background.discard)


def schedule_episode_narration(module_id: int, track_format: str) -> None:
    try:
        task = asyncio.get_running_loop().create_task(pregenerate_episode(module_id, track_format))
    except RuntimeError:
        return
    _background.add(task)
    task.add_done_callback(_background.discard)


async def pregenerate_episode(module_id: int, track_format: str) -> None:
    try:
        async with async_session_maker() as session:
            module = (await session.execute(select(LearningModule).where(LearningModule.id == module_id))).scalar_one_or_none()
            if module is None or not module.episode_script:
                return
            clips = episode_clips(json.loads(module.episode_script), track_format)
        await pregenerate_clips(clips)
    except Exception as exc:
        logger.warning("narration pregenerate_episode(%s) failed: %s", module_id, exc)


async def pregenerate_lesson(module_id: int) -> None:
    """Background job: narrate a module's script. Never raises; playback falls back to on-demand."""
    try:
        async with async_session_maker() as session:
            module = (await session.execute(select(LearningModule).where(LearningModule.id == module_id))).scalar_one_or_none()
            if module is None or not module.tts_script:
                return
            texts = lesson_chunks(module.tts_script, module.lesson_content or "")
        await pregenerate_texts(texts)
    except Exception as exc:
        logger.warning("narration pregenerate_lesson(%s) failed: %s", module_id, exc)
