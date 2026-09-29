"""Only one file parse may run at a time across the process (Render: 512 MB, 0.1 CPU)."""
from __future__ import annotations

import asyncio
import threading
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.services import file_service
from src.services.file_service import FileService, ParseTimeoutError
from src.utils.exceptions import ValidationException


class _ConcurrencyTracker:
    """Stands in for a parser; records how many run at the same moment."""

    def __init__(self, delay: float = 0.05, fail_first: bool = False) -> None:
        self._lock = threading.Lock()
        self._delay = delay
        self._fail_first = fail_first
        self.calls = 0
        self.active = 0
        self.max_active = 0

    def __call__(self, *args, **kwargs) -> str:
        with self._lock:
            self.calls += 1
            call_number = self.calls
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(self._delay)
            if self._fail_first and call_number == 1:
                raise ValidationException("first parse fails")
            return "parsed text"
        finally:
            with self._lock:
                self.active -= 1


def _upload(name: str) -> MagicMock:
    upload = MagicMock()
    upload.filename = name
    upload.read = AsyncMock(return_value=b"%PDF-1.4 content")
    upload.seek = AsyncMock(return_value=None)
    return upload


@pytest.mark.asyncio
async def test_concurrent_parses_never_overlap(monkeypatch: pytest.MonkeyPatch) -> None:
    service = FileService()
    tracker = _ConcurrencyTracker()
    monkeypatch.setattr(service, "_extract_pdf", tracker)

    await asyncio.gather(
        service.extract_from_file(_upload("a.pdf")),
        service.extract_from_file(_upload("b.pdf")),
    )

    assert tracker.calls == 2
    assert tracker.max_active == 1


@pytest.mark.asyncio
async def test_extract_from_files_parses_one_file_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    service = FileService()
    tracker = _ConcurrencyTracker()
    monkeypatch.setattr(service, "_extract_pdf", tracker)

    await service.extract_from_files([_upload("a.pdf"), _upload("b.pdf"), _upload("c.pdf")])

    assert tracker.calls == 3
    assert tracker.max_active == 1


@pytest.mark.asyncio
async def test_plain_text_parses_go_through_the_same_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    # A 40 MB .txt is decoded and regex-cleaned too; it must not run beside a PDF
    # parse or block the event loop while it does.
    service = FileService()
    tracker = _ConcurrencyTracker()
    monkeypatch.setattr(service, "_extract_pdf", tracker)
    monkeypatch.setattr(file_service, "_decode_best_effort", tracker)

    await asyncio.gather(
        service.extract_from_file(_upload("a.pdf")),
        service.extract_from_file(_upload("notes.txt")),
    )

    assert tracker.calls == 2
    assert tracker.max_active == 1


@pytest.mark.asyncio
async def test_gate_is_released_after_a_parse_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    service = FileService()
    tracker = _ConcurrencyTracker(fail_first=True)
    monkeypatch.setattr(service, "_extract_pdf", tracker)

    with pytest.raises(ValidationException):
        await service.extract_from_file(_upload("a.pdf"))

    content, _ = await asyncio.wait_for(service.extract_from_file(_upload("b.pdf")), timeout=5)
    assert content == "parsed text"


@pytest.mark.asyncio
async def test_an_expired_parse_budget_stops_a_pdf_parse(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_service, "PARSE_DEADLINE_S", -1)
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    page = MagicMock()
    page.get_text.return_value = "text"
    doc = MagicMock(page_count=3)
    doc.load_page.return_value = page
    monkeypatch.setattr(file_service, "fitz", MagicMock(open=MagicMock(return_value=doc)))

    with pytest.raises(ParseTimeoutError):
        await FileService().extract_from_file(_upload("a.pdf"))

    doc.load_page.assert_not_called()


@pytest.mark.asyncio
async def test_a_hung_parse_releases_the_gate_after_the_grace_period(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # A page stuck inside C code never reaches the between-pages deadline check.
    # The caller must still get an error, and other uploads must not queue forever.
    monkeypatch.setattr(file_service, "PARSE_DEADLINE_S", 0.05)
    monkeypatch.setattr(file_service, "PARSE_HARD_STOP_GRACE_S", 0.05)
    release = threading.Event()
    service = FileService()

    def hung_parse(*args, **kwargs) -> str:
        release.wait(timeout=10)
        return "too late"

    monkeypatch.setattr(service, "_extract_pdf", hung_parse)
    try:
        with pytest.raises(ParseTimeoutError):
            await asyncio.wait_for(service.extract_from_file(_upload("stuck.pdf")), timeout=5)

        monkeypatch.setattr(service, "_extract_pdf", lambda *args, **kwargs: "next file")
        content, _ = await asyncio.wait_for(service.extract_from_file(_upload("next.pdf")), timeout=5)
        assert content == "next file"
        assert any(record.levelname == "ERROR" and "hard stop" in record.getMessage() for record in caplog.records)
    finally:
        release.set()
