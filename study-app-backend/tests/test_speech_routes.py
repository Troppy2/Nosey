from unittest.mock import AsyncMock, patch

from src.services.speech_service import SpeechService
from src.utils.exceptions import ValidationException
import pytest


@pytest.mark.asyncio
async def test_synthesize_rejects_empty():
    with pytest.raises(ValidationException):
        await SpeechService().synthesize("   ")


@pytest.mark.asyncio
async def test_transcribe_rejects_empty_and_oversize():
    with pytest.raises(ValidationException):
        await SpeechService().transcribe(b"", "a.webm", "audio/webm")
    with pytest.raises(ValidationException):
        await SpeechService().transcribe(b"x" * (9 * 1024 * 1024), "a.webm", "audio/webm")


@pytest.mark.asyncio
async def test_transcribe_uses_groq_then_falls_back_to_openrouter():
    from src.services import speech_service as mod

    calls: list[tuple[str, str]] = []

    async def fake(self, client, base, key, model, prompt, file):
        calls.append((base, prompt))
        if base == mod._GROQ_BASE:
            raise RuntimeError("groq down")
        return "a hash map"

    with patch.object(mod.settings, "groq_api_key", "g"), patch.object(mod.settings, "openrouter_api_key", "o"), \
            patch.object(SpeechService, "_transcribe_once", fake):
        text = await SpeechService().transcribe(b"audio", "a.webm", "audio/webm", "  Walk me through\n Two Sum. ")

    assert text == "a hash map"
    assert [base for base, _ in calls] == [mod._GROQ_BASE, mod._BASE]
    # The hint leads, whitespace collapsed, and the fixed terms follow.
    assert calls[0][1].startswith("Walk me through Two Sum. hash map,")


def test_stt_prompt_caps_the_hint():
    from src.services.speech_service import MAX_STT_HINT_CHARS, _STT_TERMS, stt_prompt

    assert stt_prompt("") == _STT_TERMS
    assert len(stt_prompt("x" * 5000)) == MAX_STT_HINT_CHARS + 1 + len(_STT_TERMS)
