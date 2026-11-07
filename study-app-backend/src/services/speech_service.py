"""Interviewer and lesson voice: text to speech and speech to text through OpenRouter.

Stateless. TTS tries the free model first and falls back to a cheap one; the
browser's own speech recognition is the primary transcript source, so
transcribe() only runs for browsers without it.
"""
import asyncio
import time

import httpx

from src.config import settings
from src.utils.exceptions import LLMException, ValidationException
from src.utils.logger import get_logger

logger = get_logger(__name__)

_BASE = "https://openrouter.ai/api/v1"
MAX_TTS_CHARS = 1500
MAX_AUDIO_BYTES = 8 * 1024 * 1024
# Each voice gets a short leash so a stalled provider falls through quickly:
# Kokoro, then the free Fish voice, then (client side) the browser's own voice.
PRIMARY_TIMEOUT_SECONDS = 15.0
FALLBACK_TIMEOUT_SECONDS = 25.0
# Fish starts this long after Kokoro if Kokoro has not answered, so a slow Kokoro costs ~2s, not 15.
HEDGE_AFTER_SECONDS = 2.0
# Recording a walkthrough is not interactive, so the one voice gets longer to answer.
STRICT_TIMEOUT_SECONDS = 30.0


def _headers() -> dict[str, str]:
    if not settings.openrouter_api_key:
        raise LLMException("Voice is not configured on this server.")
    return {"Authorization": f"Bearer {settings.openrouter_api_key}"}


class SpeechService:
    async def _speak_once(self, client: httpx.AsyncClient, model: str, voice: str, text: str, timeout: float) -> bytes:
        resp = await client.post(
            f"{_BASE}/audio/speech",
            headers=_headers(),
            json={"model": model, "input": text, "voice": voice, "response_format": "mp3"},
            timeout=timeout,
        )
        resp.raise_for_status()
        if not resp.content:
            raise LLMException("Empty audio.")
        return resp.content

    async def synthesize(self, text: str, voice_override: str | None = None) -> bytes:
        """Kokoro first. If it has not answered within HEDGE_AFTER_SECONDS, or fails, the free Fish
        voice starts alongside it and whichever delivers first wins. `voice_override` replaces the
        Kokoro voice; Fish keeps its own."""
        text = (text or "").strip()
        if not text:
            raise ValidationException("Nothing to speak.")
        text = text[:MAX_TTS_CHARS]
        _headers()  # fail fast, with the right message, when voice is not configured
        async with httpx.AsyncClient() as client:
            primary = asyncio.create_task(
                self._speak_once(
                    client, settings.openrouter_tts_model, voice_override or settings.openrouter_tts_voice, text, PRIMARY_TIMEOUT_SECONDS
                )
            )
            fallback: asyncio.Task | None = None
            pending: set[asyncio.Task] = {primary}
            hedge_at = time.monotonic() + HEDGE_AFTER_SECONDS
            last: Exception | None = None
            try:
                while pending:
                    wait_for = max(0.0, hedge_at - time.monotonic()) if fallback is None else None
                    done, pending = await asyncio.wait(pending, timeout=wait_for, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        try:
                            return task.result()
                        except Exception as exc:
                            last = exc
                            logger.warning("tts %s failed: %s %s", "primary" if task is primary else "fallback", type(exc).__name__, exc)
                    if fallback is None and (time.monotonic() >= hedge_at or not pending):
                        fallback = asyncio.create_task(
                            self._speak_once(
                                client, settings.openrouter_tts_fallback_model, settings.openrouter_tts_fallback_voice, text, FALLBACK_TIMEOUT_SECONDS
                            )
                        )
                        pending.add(fallback)
                raise LLMException(f"Speech synthesis failed: {last}")
            finally:
                for task in (primary, fallback):
                    if task is not None and not task.done():
                        task.cancel()

    async def synthesize_strict(self, client: httpx.AsyncClient, text: str, voice: str, attempts: int = 3) -> bytes:
        """One voice only, never the Fish fallback: a recorded walkthrough must not switch
        voices between lines. Retries Kokoro a few times, then raises."""
        text = (text or "").strip()[:MAX_TTS_CHARS]
        if not text:
            raise ValidationException("Nothing to speak.")
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                return await self._speak_once(client, settings.openrouter_tts_model, voice, text, STRICT_TIMEOUT_SECONDS)
            except Exception as exc:  # noqa: BLE001 - retried, then reported
                last = exc
                logger.warning("strict tts attempt %d failed: %s %s", attempt + 1, type(exc).__name__, exc)
                await asyncio.sleep(0.6 * (attempt + 1))
        raise LLMException(f"Speech synthesis failed: {last}")

    async def transcribe(self, audio: bytes, filename: str, content_type: str) -> str:
        if not audio:
            raise ValidationException("No audio received.")
        if len(audio) > MAX_AUDIO_BYTES:
            raise ValidationException("Recording is too long.")
        try:
            async with httpx.AsyncClient(timeout=settings.llm_generation_timeout_seconds) as client:
                resp = await client.post(
                    f"{_BASE}/audio/transcriptions",
                    headers=_headers(),
                    data={"model": settings.openrouter_stt_model},
                    files={"file": (filename or "answer.webm", audio, content_type or "audio/webm")},
                )
                resp.raise_for_status()
                return (resp.json().get("text") or "").strip()
        except LLMException:
            raise
        except Exception as exc:
            raise LLMException(f"Transcription failed: {exc}") from exc


async def record_lines(lines: list[str], voice: str, concurrency: int = 4) -> list[str]:
    """Record every line in ONE voice (synthesize_strict), base64 mp3 per line, in order.
    All or nothing: the first line that fails cancels the rest (so nothing keeps
    retrying on a closed client) and raises LLMException."""
    import base64

    speech = SpeechService()
    gate = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient() as client:

        async def one(text: str) -> str:
            async with gate:
                return base64.b64encode(await speech.synthesize_strict(client, text, voice)).decode("ascii")

        tasks = [asyncio.create_task(one(line)) for line in lines]
        try:
            return list(await asyncio.gather(*tasks))
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
