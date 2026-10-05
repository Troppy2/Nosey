"""OCR engine routing for scratch-pad work: free Gemini first, Claude as the fallback."""
from __future__ import annotations

import pytest

from src.schemas.attempt_schema import OcrResult
from src.services import ocr_service
from src.services.ocr_service import OcrService, _candidate_ocr_engines, check_ocr_engines_status
from src.utils.provider_policy import resolve_ocr_engine

pytestmark = pytest.mark.asyncio


def _keys(monkeypatch, gemini: bool = True, claude: bool = True, order: str = "gemini,claude") -> None:
    monkeypatch.setattr("src.config.settings.google_ai_api_key", "g" if gemini else None)
    monkeypatch.setattr("src.config.settings.anthropic_api_key", "c" if claude else None)
    monkeypatch.setattr("src.config.settings.ocr_engine_order", order)


def _engine(name: str, transcript: str = "x = 1", fail: bool = False, calls: list | None = None):
    async def run(image_b64: str, media_type: str) -> OcrResult:
        if calls is not None:
            calls.append(name)
        if fail:
            raise RuntimeError(f"{name} down")
        return OcrResult(transcript=transcript, layout_notes=None, confidence=0.75, engine=name)

    return run


async def test_auto_tries_the_free_engine_first(monkeypatch) -> None:
    _keys(monkeypatch)
    assert _candidate_ocr_engines(None) == ["gemini", "claude"]
    assert _candidate_ocr_engines("auto") == ["gemini", "claude"]


async def test_a_pinned_engine_goes_first_with_the_rest_behind_it(monkeypatch) -> None:
    _keys(monkeypatch)
    assert _candidate_ocr_engines("claude") == ["claude", "gemini"]
    assert _candidate_ocr_engines("google") == ["gemini", "claude"]  # alias


async def test_engines_without_a_key_are_skipped(monkeypatch) -> None:
    _keys(monkeypatch, gemini=False)
    assert _candidate_ocr_engines(None) == ["claude"]
    _keys(monkeypatch, gemini=False, claude=False)
    assert _candidate_ocr_engines(None) == ["claude"]  # never empty


async def test_order_comes_from_settings(monkeypatch) -> None:
    _keys(monkeypatch, order="claude,gemini")
    assert _candidate_ocr_engines(None) == ["claude", "gemini"]


async def test_gemini_failure_falls_back_to_claude(monkeypatch) -> None:
    _keys(monkeypatch)
    calls: list[str] = []
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "gemini", _engine("gemini", fail=True, calls=calls))
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "claude", _engine("claude", "y = 2", calls=calls))

    result = await OcrService().transcribe("img")

    assert result is not None and result.engine == "claude" and result.transcript == "y = 2"
    assert calls == ["gemini", "claude"]


async def test_an_empty_read_also_falls_back(monkeypatch) -> None:
    _keys(monkeypatch)
    calls: list[str] = []
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "gemini", _engine("gemini", transcript="", calls=calls))
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "claude", _engine("claude", "z = 3", calls=calls))

    result = await OcrService().transcribe("img")

    assert result is not None and result.engine == "claude"


async def test_the_first_good_read_stops_the_chain(monkeypatch) -> None:
    _keys(monkeypatch)
    calls: list[str] = []
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "gemini", _engine("gemini", calls=calls))
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "claude", _engine("claude", calls=calls))

    result = await OcrService().transcribe("img")

    assert result is not None and result.engine == "gemini"
    assert calls == ["gemini"]  # Claude is never paid for


async def test_every_engine_failing_returns_none_without_raising(monkeypatch) -> None:
    _keys(monkeypatch)
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "gemini", _engine("gemini", fail=True))
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "claude", _engine("claude", fail=True))

    assert await OcrService().transcribe("img") is None


async def test_engine_status_reports_both_keys(monkeypatch) -> None:
    _keys(monkeypatch, claude=False)
    assert check_ocr_engines_status() == {"claude": False, "gemini": True}


class _User:
    def __init__(self, privileged: bool) -> None:
        self.is_admin = privileged
        self.is_beta = False


async def test_ordinary_users_always_get_auto_and_privileged_users_may_pin() -> None:
    assert resolve_ocr_engine(_User(False), "claude") == "auto"
    assert resolve_ocr_engine(_User(True), "claude") == "claude"
    assert resolve_ocr_engine(_User(True), "gemini") == "gemini"
    assert resolve_ocr_engine(_User(True), "nonsense") == "auto"
    assert resolve_ocr_engine(_User(True), None) == "auto"
