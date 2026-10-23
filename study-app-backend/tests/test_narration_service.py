import io
import json

import numpy as np
import pytest
import soundfile as sf

from src.services import narration_service as ns
from src.utils.lesson_blocks import split_lesson_blocks


def _speech_like_mp3(seconds: float = 3.0) -> bytes:
    """A 24 kHz stereo mp3 at the provider's high bitrate, standing in for a Kokoro clip."""
    rate = 24000
    t = np.linspace(0, seconds, int(rate * seconds), endpoint=False)
    wave = (0.3 * np.sin(2 * np.pi * 220 * t) + 0.1 * np.random.default_rng(0).standard_normal(len(t))).astype("float32")
    buf = io.BytesIO()
    sf.write(buf, np.stack([wave, wave], axis=1), rate, format="MP3", subtype="MPEG_LAYER_III", compression_level=0.0)
    return buf.getvalue()


def test_compress_makes_audio_much_smaller_but_still_playable():
    source = _speech_like_mp3()
    small, content_type = ns.compress(source)
    assert content_type == "audio/mpeg"
    assert len(small) < len(source) / 2
    data, rate = sf.read(io.BytesIO(small))
    assert rate == 24000  # the sample rate is kept: down-sampling made the voice tinny
    assert data.ndim == 1
    assert abs(len(data) / rate - 3.0) < 0.2


def test_compress_keeps_the_original_when_it_cannot_decode():
    assert ns.compress(b"not audio") == (b"not audio", "audio/mpeg")


@pytest.mark.asyncio
async def test_ensure_clip_generates_once_then_reads_from_the_database(db_session_maker, monkeypatch):
    calls: list[tuple[str, str]] = []

    async def fake_synthesize(self, text, voice_override=None):
        calls.append((voice_override, text))
        return _speech_like_mp3(1.0)

    monkeypatch.setattr(ns.SpeechService, "synthesize", fake_synthesize)
    async with db_session_maker() as session:
        first = await ns.ensure_clip(session, "af_heart", "  Hello there.  ")
        second = await ns.ensure_clip(session, "af_heart", "Hello there.")  # same text, whitespace aside
        other_voice = await ns.ensure_clip(session, "bm_george", "Hello there.")
    assert len(calls) == 2
    assert first.id == second.id != other_voice.id
    assert first.size_bytes == len(first.audio) > 0


@pytest.mark.asyncio
async def test_pregenerate_skips_clips_already_stored_and_survives_failures(db_session_maker, monkeypatch):
    spoken: list[str] = []

    async def fake_synthesize(self, text, voice_override=None):
        if text == "bad":
            raise RuntimeError("provider down")
        spoken.append(text)
        return _speech_like_mp3(0.5)

    monkeypatch.setattr(ns.SpeechService, "synthesize", fake_synthesize)
    monkeypatch.setattr(ns, "async_session_maker", db_session_maker)
    await ns.pregenerate_texts(["one", "two", "bad", "one"])
    assert sorted(spoken) == ["one", "two"]
    await ns.pregenerate_texts(["one", "two", "three"])
    assert sorted(spoken) == ["one", "three", "two"]


def test_lesson_chunks_speaks_one_entry_per_block():
    lesson = "# Title\n\nFirst paragraph.\n\nSecond paragraph."
    blocks = split_lesson_blocks(lesson)
    script = json.dumps([f"Spoken {i}." for i in range(len(blocks))])
    assert ns.lesson_chunks(script, lesson) == [f"Spoken {i}." for i in range(len(blocks))]


def test_lesson_chunks_falls_back_to_paragraphs_for_a_plain_script():
    assert ns.lesson_chunks("Alpha.\n\nBeta **bold**.", "ignored") == ["Alpha.", "Beta bold."]


def test_episode_clips_use_two_voices_for_a_podcast_and_one_for_a_lecture():
    turns = [{"speaker": "host", "text": "Welcome."}, {"speaker": "expert", "text": "Binary search is O(log n)."}]
    assert ns.episode_clips(turns, "podcast") == [
        ("af_heart", "Welcome."),
        ("bm_george", "Binary search is O of log n."),
    ]
    assert {voice for voice, _ in ns.episode_clips(turns, "lecture")} == {"af_heart"}
