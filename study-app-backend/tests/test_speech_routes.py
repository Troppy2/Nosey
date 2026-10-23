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
