from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.services import file_service
from src.services.file_service import PDF_PAGE_CAP, ParseProgress, ParseTimeoutError, _extract_pdf_pages
from src.utils.exceptions import ValidationException

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_importing_file_service_does_not_load_onnxruntime() -> None:
    """pymupdf4llm >= 1.27.2.1 hard-requires pymupdf-layout, which activates an
    onnxruntime layout model on import (~74 MB resident, more per parse). That is
    what the Render 512 MB box could not afford, so the PDF stack stays pre-layout.

    Runs in a subprocess because other tests may already have imported modules.
    """
    probe = (
        "import sys; import src.services.file_service; "
        "print('LOADED=' + ','.join(m for m in ('onnxruntime', 'pymupdf.layout') if m in sys.modules))"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    # PyMuPDF prints its own notices to stdout, so read only the marker line.
    marker = next(line for line in result.stdout.splitlines() if line.startswith("LOADED="))
    assert marker == "LOADED="


class _FakePage:
    def __init__(self, text: str) -> None:
        self._text = text

    def get_text(self, mode: str = "text") -> str:
        return self._text


class _FakeDoc:
    def __init__(self, page_texts: list[str]) -> None:
        self._page_texts = page_texts
        self.loaded: list[int] = []
        self.closed = False

    @property
    def page_count(self) -> int:
        return len(self._page_texts)

    def load_page(self, index: int) -> _FakePage:
        self.loaded.append(index)
        return _FakePage(self._page_texts[index])

    def close(self) -> None:
        self.closed = True


def _use_fake_fitz(monkeypatch: pytest.MonkeyPatch, doc: _FakeDoc) -> SimpleNamespace:
    fake_fitz = SimpleNamespace(
        open=MagicMock(return_value=doc),
        TOOLS=SimpleNamespace(store_shrink=MagicMock()),
    )
    monkeypatch.setattr(file_service, "fitz", fake_fitz)
    return fake_fitz


def _use_fake_pymupdf4llm(monkeypatch: pytest.MonkeyPatch, to_markdown) -> SimpleNamespace:
    fake = SimpleNamespace(
        IdentifyHeaders=MagicMock(return_value="HEADERS"),
        to_markdown=MagicMock(side_effect=to_markdown),
    )
    monkeypatch.setattr(file_service, "pymupdf4llm", fake)
    return fake


def _no_pdfplumber(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        file_service.pdfplumber,
        "open",
        MagicMock(side_effect=AssertionError("pdfplumber must not be used when PyMuPDF opens the file")),
    )


def test_pdf_is_read_page_by_page_from_one_open_document(monkeypatch: pytest.MonkeyPatch) -> None:
    # Worker processes each re-imported the PDF stack and copied the file; the
    # page-by-page parser must not start any.
    monkeypatch.setattr(
        file_service,
        "ProcessPoolExecutor",
        MagicMock(side_effect=AssertionError("no worker processes")),
        raising=False,
    )
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    doc = _FakeDoc(["one", "two", "three", "four", "five"])
    fake_fitz = _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)
    progress = ParseProgress()

    result = _extract_pdf_pages(b"%PDF-1.4", progress)

    assert result.text == "one\ntwo\nthree\nfour\nfive"
    fake_fitz.open.assert_called_once()
    assert doc.loaded == [0, 1, 2, 3, 4]
    assert doc.closed is True
    assert (progress.pages_done, progress.pages_total) == (5, 5)


def test_pymupdf4llm_runs_per_page_with_headers_identified_once(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _FakeDoc(["a", "b", "c"])
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)
    fake = _use_fake_pymupdf4llm(monkeypatch, lambda d, pages, **kwargs: f"# md {pages[0]}")

    result = _extract_pdf_pages(b"%PDF-1.4", ParseProgress())

    assert result.text == "# md 0\n# md 1\n# md 2"
    fake.IdentifyHeaders.assert_called_once()
    assert [c.kwargs["pages"] for c in fake.to_markdown.call_args_list] == [[0], [1], [2]]
    # Without a shared hdr_info, to_markdown re-scans the whole document per call.
    assert all(c.kwargs["hdr_info"] == "HEADERS" for c in fake.to_markdown.call_args_list)


def test_page_falls_back_to_plain_text_when_pymupdf4llm_fails_on_it(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _FakeDoc(["plain 0", "plain 1", "plain 2"])
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)

    def to_markdown(d, pages, **kwargs):
        if pages == [1]:
            raise RuntimeError("table detection blew up")
        return f"# md {pages[0]}"

    _use_fake_pymupdf4llm(monkeypatch, to_markdown)

    result = _extract_pdf_pages(b"%PDF-1.4", ParseProgress())

    assert result.text == "# md 0\nplain 1\n# md 2"


def test_pdf_reads_at_most_the_page_cap_and_reports_the_true_page_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    doc = _FakeDoc([f"page {i}" for i in range(812)])
    fake_fitz = _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)
    progress = ParseProgress()

    result = _extract_pdf_pages(b"%PDF-1.4", progress)

    assert PDF_PAGE_CAP == 300
    assert doc.loaded == list(range(300))
    assert (result.pages_read, result.page_count) == (300, 812)
    assert (progress.pages_done, progress.pages_total) == (300, 300)
    # MuPDF's global resource cache is flushed as the parse goes, not only at the end.
    assert fake_fitz.TOOLS.store_shrink.call_count >= 300 // 25


def test_pdfplumber_is_used_only_when_pymupdf_cannot_open_the_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        file_service,
        "fitz",
        SimpleNamespace(open=MagicMock(side_effect=RuntimeError("cannot open broken document"))),
    )

    class _PlumberPage:
        def __init__(self, text: str) -> None:
            self._text = text
            self.flushed = False
            self.get_textmap = SimpleNamespace(cache_clear=MagicMock())

        def extract_text(self) -> str:
            return self._text

        def flush_cache(self) -> None:
            self.flushed = True

    pages = [_PlumberPage("p0"), _PlumberPage("p1")]
    plumber_doc = MagicMock()
    plumber_doc.__enter__.return_value = SimpleNamespace(pages=pages)
    plumber_doc.__exit__.return_value = False
    monkeypatch.setattr(file_service.pdfplumber, "open", MagicMock(return_value=plumber_doc))

    result = _extract_pdf_pages(b"%PDF-1.4", ParseProgress())

    assert result.text == "p0\np1"
    assert all(page.flushed for page in pages)
    assert all(page.get_textmap.cache_clear.called for page in pages)


def test_pdf_with_no_text_raises_validation_error_and_closes_the_document(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    doc = _FakeDoc(["", "   ", ""])
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)

    with pytest.raises(ValidationException, match="No text could be extracted"):
        _extract_pdf_pages(b"%PDF-1.4", ParseProgress())

    assert doc.closed is True


def test_pdf_parse_stops_between_pages_once_the_deadline_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    doc = _FakeDoc([f"page {i}" for i in range(10)])
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)
    ticks = iter(range(0, 1000, 10))  # every clock read is 10 s later

    with pytest.raises(ParseTimeoutError) as caught:
        _extract_pdf_pages(b"%PDF-1.4", ParseProgress(), deadline=25.0, clock=lambda: float(next(ticks)))

    # Checked before each page: reads at t=0, 10, 20 pass; t=30 is past the deadline.
    assert doc.loaded == [0, 1, 2]
    assert doc.closed is True
    assert str(caught.value) == "This file took too long to read. Try splitting it into smaller files."
    # Existing handlers map ValidationException to a 400 / an upload_error message.
    assert isinstance(caught.value, ValidationException)


# --- page ranges for batched reading (GH #121) ------------------------------------


def test_a_later_batch_reads_only_its_page_range(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    doc = _FakeDoc([f"page {i}" for i in range(812)])
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)
    progress = ParseProgress()

    result = _extract_pdf_pages(b"%PDF-1.4", progress, start=300, batch=300, max_pages=1500)

    assert doc.loaded == list(range(300, 600))
    assert result.text.startswith("page 300\n") and result.text.endswith("\npage 599")
    # pages_read counts from the start of the book, so notes read "first 600 of 812".
    assert (result.pages_read, result.page_count) == (600, 812)
    assert (progress.pages_done, progress.pages_total) == (600, 812)
    assert doc.closed is True


def test_first_batch_reports_the_whole_book_as_the_total(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    doc = _FakeDoc([f"page {i}" for i in range(812)])
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)
    progress = ParseProgress()

    result = _extract_pdf_pages(b"%PDF-1.4", progress, batch=300, max_pages=1500)

    assert doc.loaded == list(range(300))
    assert (result.pages_read, result.page_count) == (300, 812)
    assert (progress.pages_done, progress.pages_total) == (300, 812)


def test_batches_stop_at_the_page_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    doc = _FakeDoc([f"page {i}" for i in range(2000)])
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)
    progress = ParseProgress()

    result = _extract_pdf_pages(b"%PDF-1.4", progress, start=1200, batch=500, max_pages=1500)

    assert doc.loaded == list(range(1200, 1500))
    assert (result.pages_read, result.page_count) == (1500, 2000)
    assert progress.pages_total == 1500


def test_a_later_batch_without_text_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    # Only the first batch decides whether the file is readable at all; a run of
    # scanned figure pages later in the book just adds nothing.
    monkeypatch.setattr(file_service, "pymupdf4llm", None)
    doc = _FakeDoc(["intro"] * 3 + [""] * 3)
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)

    result = _extract_pdf_pages(b"%PDF-1.4", ParseProgress(), start=3, batch=3, max_pages=1500)

    assert (result.text, result.pages_read) == ("", 6)


def test_later_batches_detect_headers_from_the_same_opening_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _FakeDoc([f"p{i}" for i in range(400)])
    _use_fake_fitz(monkeypatch, doc)
    _no_pdfplumber(monkeypatch)
    fake = _use_fake_pymupdf4llm(monkeypatch, lambda d, pages, **kwargs: f"# md {pages[0]}")

    _extract_pdf_pages(b"%PDF-1.4", ParseProgress(), start=300, batch=300, max_pages=1500)

    assert fake.IdentifyHeaders.call_args.kwargs["pages"] == list(range(30))
    assert [c.kwargs["pages"] for c in fake.to_markdown.call_args_list] == [[i] for i in range(300, 400)]


def test_pdfplumber_fallback_reads_the_same_page_range(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        file_service,
        "fitz",
        SimpleNamespace(open=MagicMock(side_effect=RuntimeError("cannot open broken document"))),
    )
    read: list[int] = []

    class _PlumberPage:
        def __init__(self, index: int) -> None:
            self._index = index
            self.get_textmap = SimpleNamespace(cache_clear=MagicMock())

        def extract_text(self) -> str:
            read.append(self._index)
            return f"p{self._index}"

        def flush_cache(self) -> None:
            pass

    plumber_doc = MagicMock()
    plumber_doc.__enter__.return_value = SimpleNamespace(pages=[_PlumberPage(i) for i in range(10)])
    plumber_doc.__exit__.return_value = False
    monkeypatch.setattr(file_service.pdfplumber, "open", MagicMock(return_value=plumber_doc))

    result = _extract_pdf_pages(b"%PDF-1.4", ParseProgress(), start=4, batch=4, max_pages=1500)

    assert read == [4, 5, 6, 7]
    assert (result.text, result.pages_read, result.page_count) == ("p4\np5\np6\np7", 8, 10)
