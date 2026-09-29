"""Parsing from a saved file with page progress reported on the event loop."""
from __future__ import annotations

import time
from pathlib import Path

import pytest

from src.services import file_service
from src.services.file_service import ExtractionResult, FileService, ParseProgress, PdfText

pytestmark = pytest.mark.asyncio


def _saved_pdf(tmp_path: Path) -> str:
    path = tmp_path / "nosey-upload-test.pdf"
    path.write_bytes(b"%PDF-1.4 fake")
    return str(path)


def _fake_pdf_parser(pages: int, page_count: int, delay: float):
    """Stands in for _extract_pdf_pages: advances the counters like the real loop."""

    def parse(source, progress: ParseProgress, deadline=None, clock=time.monotonic) -> PdfText:
        progress.pages_total = pages
        for done in range(1, pages + 1):
            time.sleep(delay)
            progress.pages_done = done
        return PdfText("Page text", pages, page_count)

    return parse


class _Recorder:
    def __init__(self, fail: bool = False) -> None:
        self.snapshots: list[tuple[int, int | None]] = []
        self._fail = fail

    async def __call__(self, progress: ParseProgress) -> None:
        self.snapshots.append((progress.pages_done, progress.pages_total))
        if self._fail:
            raise RuntimeError("database hiccup")


async def test_progress_reports_start_then_pages_then_the_end(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(file_service, "_PROGRESS_POLL_S", 0.01)
    monkeypatch.setattr(file_service, "_extract_pdf_pages", _fake_pdf_parser(pages=3, page_count=3, delay=0.05))
    recorder = _Recorder()

    result = await FileService().extract_from_path(_saved_pdf(tmp_path), "notes.pdf", on_progress=recorder)

    # (0, None) first: the parse has its slot, so the row stops showing "waiting".
    assert recorder.snapshots[0] == (0, None)
    assert recorder.snapshots[-1] == (3, 3)
    assert len(recorder.snapshots) >= 3
    assert all(a != b for a, b in zip(recorder.snapshots, recorder.snapshots[1:]))
    assert result == ExtractionResult("Page text", "pdf", pages_read=3, page_count=3)


async def test_progress_is_reported_no_more_often_than_the_poll_interval(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(file_service, "_PROGRESS_POLL_S", 0.1)
    monkeypatch.setattr(file_service, "_extract_pdf_pages", _fake_pdf_parser(pages=100, page_count=100, delay=0.002))
    recorder = _Recorder()

    await FileService().extract_from_path(_saved_pdf(tmp_path), "notes.pdf", on_progress=recorder)

    # ~0.2 s of parsing at a 0.1 s poll: start + a couple of polls + the end.
    assert len(recorder.snapshots) <= 6


async def test_capped_pdf_reports_pages_read_and_true_page_count(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(file_service, "_extract_pdf_pages", _fake_pdf_parser(pages=3, page_count=812, delay=0))

    result = await FileService().extract_from_path(_saved_pdf(tmp_path), "long.pdf")

    assert (result.pages_read, result.page_count, result.file_type) == (3, 812, "pdf")


async def test_a_failing_progress_callback_does_not_fail_the_parse(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(file_service, "_PROGRESS_POLL_S", 0.01)
    monkeypatch.setattr(file_service, "_extract_pdf_pages", _fake_pdf_parser(pages=2, page_count=2, delay=0.02))

    result = await FileService().extract_from_path(
        _saved_pdf(tmp_path), "notes.pdf", on_progress=_Recorder(fail=True)
    )

    assert result.text == "Page text"


async def test_non_pdf_files_are_read_from_the_path(tmp_path) -> None:
    path = tmp_path / "nosey-upload-notes.txt"
    path.write_bytes(b"Mitochondria make ATP.\nRibosomes make proteins.")
    recorder = _Recorder()

    result = await FileService().extract_from_path(str(path), "notes.txt", on_progress=recorder)

    assert result.text == "Mitochondria make ATP.\nRibosomes make proteins."
    assert (result.file_type, result.pages_read, result.page_count) == ("txt", None, None)
    assert recorder.snapshots[0] == (0, None)
