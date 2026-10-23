"""Mock interview voice: text to speech and speech to text through OpenRouter.

Stateless. TTS tries the free model first and falls back to a cheap one; the
browser's own speech recognition is the primary transcript source, so
transcribe() only runs for browsers without it.
"""
import httpx

from src.config import settings
from src.utils.exceptions import LLMException, ValidationException
from src.utils.logger import get_logger

logger = get_logger(__name__)

_BASE = "https://openrouter.ai/api/v1"
MAX_TTS_CHARS = 1500
MAX_AUDIO_BYTES = 8 * 1024 * 1024


def _headers() -> dict[str, str]:
    if not settings.openrouter_api_key:
        raise LLMException("Voice is not configured on this server.")
    return {"Authorization": f"Bearer {settings.openrouter_api_key}"}


class SpeechService:
    async def synthesize(self, text: str) -> bytes:
        text = (text or "").strip()
        if not text:
            raise ValidationException("Nothing to speak.")
        text = text[:MAX_TTS_CHARS]
        last: Exception | None = None
        async with httpx.AsyncClient(timeout=settings.llm_generation_timeout_seconds) as client:
            for model, voice in (
                (settings.openrouter_tts_model, settings.openrouter_tts_voice),
                (settings.openrouter_tts_fallback_model, settings.openrouter_tts_fallback_voice),
            ):
                try:
                    resp = await client.post(
                        f"{_BASE}/audio/speech",
                        headers=_headers(),
                        json={
                            "model": model,
                            "input": text,
                            "voice": voice,
                            "response_format": "mp3",
                        },
                    )
                    resp.raise_for_status()
                    if resp.content:
                        return resp.content
                except LLMException:
                    raise
                except Exception as exc:  # try the next model
                    last = exc
                    logger.warning("tts model %s failed: %s", model, exc)
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
