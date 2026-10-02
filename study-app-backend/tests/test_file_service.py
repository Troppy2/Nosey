from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.services.file_service import FileService


class _FakePdfplumberPage:
    def __init__(self, text: str) -> None:
        self._text = text
        self.get_textmap = SimpleNamespace(cache_clear=lambda: None)

    def extract_text(self) -> str:
        return self._text

    def flush_cache(self) -> None:
        return None


class _FakePdfplumberDoc:
    def __init__(self, page_texts: list[str]) -> None:
        self.pages = [_FakePdfplumberPage(text) for text in page_texts]

    def __enter__(self) -> _FakePdfplumberDoc:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakePyMuPDFPage:
    def __init__(self, text: str) -> None:
        self._text = text

    def get_text(self, mode: str) -> str:
        return self._text


class _FakePyMuPDFDoc:
    def __init__(self, page_texts: list[str]) -> None:
        self._page_texts = page_texts

    @property
    def page_count(self) -> int:
        return len(self._page_texts)

    def load_page(self, index: int) -> _FakePyMuPDFPage:
        return _FakePyMuPDFPage(self._page_texts[index])

    def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_extract_from_file_uses_pymupdf_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    service = FileService()
    fake_doc = _FakePyMuPDFDoc(["first page", "second page"])
    fake_fitz = SimpleNamespace(open=MagicMock(return_value=fake_doc))

    monkeypatch.setattr("src.services.file_service.fitz", fake_fitz)
    monkeypatch.setattr("src.services.file_service.pymupdf4llm", None)
    monkeypatch.setattr(
        "src.services.file_service.pdfplumber.open",
        MagicMock(side_effect=AssertionError("pdfplumber should not be used")),
    )

    upload = MagicMock()
    upload.filename = "notes.pdf"
    upload.read = AsyncMock(return_value=b"%PDF-1.4")

    content, file_type = await service.extract_from_file(upload)

    assert file_type == "pdf"
    assert content == "first page\nsecond page"
    fake_fitz.open.assert_called_once()


@pytest.mark.asyncio
async def test_extract_from_file_falls_back_to_pdfplumber_when_pymupdf_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = FileService()
    fake_pdf_doc = _FakePdfplumberDoc(["fallback page"])
    fake_fitz = SimpleNamespace(open=MagicMock(side_effect=RuntimeError("boom")))

    monkeypatch.setattr("src.services.file_service.fitz", fake_fitz)
    monkeypatch.setattr("src.services.file_service.pdfplumber.open", MagicMock(return_value=fake_pdf_doc))

    upload = MagicMock()
    upload.filename = "notes.pdf"
    upload.read = AsyncMock(return_value=b"%PDF-1.4")

    content, file_type = await service.extract_from_file(upload)

    assert file_type == "pdf"
    assert content == "fallback page"


@pytest.mark.asyncio
async def test_extract_from_files_preserves_order_with_parallel_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = FileService()

    async def fake_extract(notes_file):
        if notes_file.filename == "second.txt":
            await asyncio.sleep(0.01)
        else:
            await asyncio.sleep(0.02)
        return notes_file.filename.upper(), "txt"

    monkeypatch.setattr(service, "extract_from_file", fake_extract)

    first = MagicMock(filename="first.txt")
    second = MagicMock(filename="second.txt")

    content, file_types = await service.extract_from_files([first, second])

    assert file_types == ["txt", "txt"]
    assert content.index("Document 1: first.txt") < content.index("Document 2: second.txt")


# --- cleaning exam content (GH #133) ---------------------------------------------

from src.services.file_service import _clean_extracted_text, _strip_pdf_emphasis  # noqa: E402

_PAD = "This is an ordinary sentence of lecture text.\n"


@pytest.mark.parametrize("line", [
    "(a) _b_ = (0 _, a_ ).",
    "(c) 2 _a_ + _c_ .",
    "+ 4 _c_ .",
    "b) 0.50 L",
])
def test_short_math_and_labeled_lines_survive_cleaning(line: str) -> None:
    """REGRESSION: the symbol-ratio filter counted spaces and markdown
    underscores, so every short math part of an exam was deleted at upload."""
    assert line in _clean_extracted_text(_PAD + line + "\n" + _PAD)


@pytest.mark.parametrize("line", ["----", "* * *", "|||", "~~"])
def test_symbol_junk_is_still_dropped(line: str) -> None:
    assert line not in _clean_extracted_text(_PAD + line + "\n" + _PAD)


def test_repeated_answer_options_survive_but_repeated_headers_do_not() -> None:
    """REGRESSION: lines repeated 4+ times were dropped as headers, which took
    every True/False option out of a true/false section."""
    blocks = [
        f"CHEM 1010 - General Chemistry I\n{i}. Statement number {i} about the topic.\nTrue\nFalse"
        for i in range(1, 6)
    ]
    out = _clean_extracted_text("\n".join(blocks))
    assert "CHEM 1010" not in out
    assert out.count("True") == 5 and out.count("False") == 5


def test_pdf_emphasis_markers_are_removed() -> None:
    raw = "( _a,_ 1) + ( _c_ 1 _, b_ ). **1.2** **Vector** **notation** keeps snake_case_names"
    assert _strip_pdf_emphasis(raw) == "( a, 1) + ( c 1 , b ). 1.2 Vector notation keeps snake_case_names"
