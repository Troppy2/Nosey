from __future__ import annotations

import asyncio
import html as html_lib
import os
import re
import time
import unicodedata
import weakref
from collections import defaultdict
from dataclasses import dataclass
from io import BytesIO
from typing import Awaitable, Callable, Optional, TypeVar

import pdfplumber
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.utils.exceptions import ValidationException
from src.utils.logger import get_logger
from src.utils.validators import (
    ALLOWED_FILE_TYPES,
    MAX_UPLOAD_FILE_SIZE_BYTES,
    MAX_UPLOAD_TOTAL_SIZE_BYTES,
    normalize_file_extension,
)

logger = get_logger(__name__)

try:
    import fitz  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependency
    fitz = None  # type: ignore[assignment]

try:
    import pymupdf4llm  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependency
    pymupdf4llm = None  # type: ignore[assignment]

try:
    import docx as python_docx  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependency
    python_docx = None  # type: ignore[assignment]

try:
    from bs4 import BeautifulSoup  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependency
    BeautifulSoup = None  # type: ignore[assignment]

try:
    from pptx import Presentation  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependency
    Presentation = None  # type: ignore[assignment]


# Hard cap on pages read from any PDF. Pages are parsed one at a time, so memory
# stays flat as this grows; the cap bounds parse time on Render's 0.1 CPU instead.
PDF_PAGE_CAP = 300

# MuPDF keeps fonts and images in a global cache that can grow to 256 MB (half the
# Render box), so it is flushed every few pages instead of only at the end.
_MUPDF_STORE_FLUSH_EVERY = 25

# Header levels come from font sizes, which stay consistent through a document, so
# a sample of pages is enough and keeps the extra scan cheap on long PDFs.
_HEADER_SAMPLE_PAGES = 30

# Time budget for one parse, checked between pages. A 300-page PDF takes roughly
# 5-8 minutes on Render's 0.1 CPU. The grace period covers a single page stuck in C
# code, which the between-pages check cannot interrupt.
PARSE_DEADLINE_S = 15 * 60
PARSE_HARD_STOP_GRACE_S = 60


class ParseTimeoutError(ValidationException):
    """A parse ran out of time. The message is shown to the user."""

    def __init__(self) -> None:
        super().__init__("This file took too long to read. Try splitting it into smaller files.")


_CODE_FILE_TYPES = {
    "py", "js", "ts", "tsx", "jsx", "java", "c", "cpp", "h", "hpp",
    "cs", "go", "rs", "swift", "kt", "ml", "mli", "scala", "rb", "php", "sql", "json", "xml", "yaml", "yml",
}


# One file parse at a time across the whole process. On Render's free tier
# (512 MB, 0.1 CPU) parallel parses add memory without adding speed. This is a
# deliberate process-wide resource guard, not per-request service state. Keyed by
# event loop because an asyncio.Semaphore binds to the loop that first waits on it.
_parse_gates: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = (
    weakref.WeakKeyDictionary()
)


def _parse_gate() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    gate = _parse_gates.get(loop)
    if gate is None:
        gate = _parse_gates[loop] = asyncio.Semaphore(1)
    return gate


@dataclass
class ParseProgress:
    """Page counters written by the parse thread and read by the event loop.

    Plain int assignment is atomic under the GIL, so no lock is needed.
    """

    pages_done: int = 0
    pages_total: Optional[int] = None


@dataclass
class PdfText:
    text: str
    pages_read: int
    page_count: int


@dataclass
class ExtractionResult:
    text: str
    file_type: str
    pages_read: Optional[int] = None
    page_count: Optional[int] = None


# How often parse progress is written while a parse runs (one small UPDATE each).
_PROGRESS_POLL_S = 3.0

_UNSUPPORTED_TYPE_MESSAGE = "Supported file types: PDF, DOCX, TXT, MD, HTML, PPTX, and common code files"

T = TypeVar("T")


def _join_extracted_chunks(chunks: list[str]) -> str:
    return "\n".join(chunk.strip() for chunk in chunks if chunk and chunk.strip()).strip()


def _decode_best_effort(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except Exception:
            continue
    return data.decode("utf-8", errors="ignore")


def _collapse_whitespace_lines(text: str) -> str:
    text = re.sub(r"\u00a0", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# Math symbols that should survive the short-line noise filter even when alone on a line.
# Integral signs appear as single chars (∫) when the PDF has no bounds on the same line.
_MATH_KEEP_CHARS = frozenset(
    "∫∬∭∮∯∰∑∏√∂∇∞±×÷≤≥≠≈∈∉⊂⊃∪∩ΣΠΩαβγδεζηθλμπρστφψω"
)


def _is_ocr_noise_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    if len(stripped) <= 2:
        # Preserve lone math/Greek symbols — dropping them erases integral signs
        # from indefinite-integral questions where no bound follows on the same line.
        if any(ch in _MATH_KEEP_CHARS for ch in stripped):
            return False
        return True
    if re.fullmatch(r"[\W_]+", stripped):
        return True
    letters = sum(1 for ch in stripped if ch.isalpha())
    digits = sum(1 for ch in stripped if ch.isdigit())
    printable = sum(1 for ch in stripped if ch.isprintable())
    if printable == 0:
        return True
    symbol_ratio = 1.0 - ((letters + digits) / max(1, len(stripped)))
    return symbol_ratio > 0.7 and len(stripped) < 24


def _clean_extracted_text(text: str, preserve_code: bool = False) -> str:
    cleaned = unicodedata.normalize("NFKC", text or "")
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", cleaned)
    cleaned = cleaned.replace("\ufffd", " ")

    # Rejoin words broken across lines by OCR/PDF extraction.
    cleaned = re.sub(r"(\w)-\n(\w)", r"\1\2", cleaned)

    lines = [line.strip() for line in cleaned.split("\n")]
    if not preserve_code:
        freq: dict[str, int] = defaultdict(int)
        for line in lines:
            key = line.strip().lower()
            if key:
                freq[key] += 1

        filtered: list[str] = []
        prev = ""
        for line in lines:
            key = line.strip().lower()
            if not key:
                filtered.append("")
                continue
            # Drop frequent short repeated lines (headers/footers/page artifacts).
            if len(key) < 90 and freq[key] >= 4:
                continue
            if _is_ocr_noise_line(line):
                continue
            if key == prev:
                continue
            filtered.append(line)
            prev = key
        lines = filtered

    cleaned = "\n".join(lines)
    return _collapse_whitespace_lines(cleaned)


def _flush_mupdf_store() -> None:
    tools = getattr(fitz, "TOOLS", None)
    if tools is not None:
        tools.store_shrink(100)


def _open_pymupdf(source: bytes | str):
    if isinstance(source, str):
        return fitz.open(source, filetype="pdf")
    return fitz.open(stream=source, filetype="pdf")


def _identify_headers(document, page_limit: int):
    # Always sampled from the opening pages, so every batch of a book gets the same
    # heading levels.
    if pymupdf4llm is None:
        return None
    try:
        sample = list(range(min(page_limit, _HEADER_SAMPLE_PAGES)))
        return pymupdf4llm.IdentifyHeaders(document, pages=sample)
    except Exception:
        return None


def _pymupdf_page_text(document, index: int, headers) -> str:
    # Markdown keeps headings and tables for the LLM. The shared hdr_info matters:
    # without it, to_markdown re-scans every page of the document on each call.
    if headers is not None:
        try:
            markdown = pymupdf4llm.to_markdown(
                document, pages=[index], hdr_info=headers, ignore_images=True, show_progress=False
            )
            if markdown and markdown.strip():
                return markdown
        except Exception:
            pass
    try:
        return document.load_page(index).get_text("text") or ""
    except Exception:
        return ""


def _check_deadline(deadline: Optional[float], clock: Callable[[], float]) -> None:
    if deadline is not None and clock() > deadline:
        raise ParseTimeoutError()


@dataclass(frozen=True)
class _PageRange:
    """Which pages one parse reads: [start, start + batch), never past max_pages."""

    start: int
    batch: int
    max_pages: int

    def total(self, page_count: int) -> int:
        return min(page_count, self.max_pages)

    def stop(self, page_count: int) -> int:
        return min(self.start + self.batch, self.total(page_count))


def _extract_with_pymupdf(
    document,
    pages: _PageRange,
    progress: ParseProgress,
    deadline: Optional[float],
    clock: Callable[[], float],
) -> PdfText:
    page_count = int(document.page_count)
    stop = pages.stop(page_count)
    progress.pages_total = pages.total(page_count)
    headers = _identify_headers(document, progress.pages_total)
    parts: list[str] = []
    for index in range(pages.start, stop):
        _check_deadline(deadline, clock)
        parts.append(_pymupdf_page_text(document, index, headers))
        progress.pages_done = index + 1
        if (index + 1 - pages.start) % _MUPDF_STORE_FLUSH_EVERY == 0:
            _flush_mupdf_store()
    return PdfText(_join_extracted_chunks(parts), max(stop, pages.start), page_count)


def _extract_with_pdfplumber(
    source: bytes | str,
    pages: _PageRange,
    progress: ParseProgress,
    deadline: Optional[float],
    clock: Callable[[], float],
) -> PdfText:
    with pdfplumber.open(source if isinstance(source, str) else BytesIO(source)) as pdf:
        page_count = len(pdf.pages)
        stop = pages.stop(page_count)
        progress.pages_total = pages.total(page_count)
        parts: list[str] = []
        for index in range(pages.start, stop):
            _check_deadline(deadline, clock)
            page = pdf.pages[index]
            parts.append(page.extract_text() or "")
            # pdfplumber caches each page's parsed layout; drop it before the next page.
            page.flush_cache()
            page.get_textmap.cache_clear()
            progress.pages_done = index + 1
    return PdfText(_join_extracted_chunks(parts), max(stop, pages.start), page_count)


def _extract_pdf_pages(
    source: bytes | str,
    progress: ParseProgress,
    deadline: Optional[float] = None,
    clock: Callable[[], float] = time.monotonic,
    *,
    start: int = 0,
    batch: int = PDF_PAGE_CAP,
    max_pages: int = PDF_PAGE_CAP,
) -> PdfText:
    """Read a PDF one page at a time from a single open document.

    Runs in a worker thread and never starts processes: on Render's 512 MB box every
    extra process re-imports the PDF stack and holds its own copy of the file.
    PyMuPDF handles nearly every file (pymupdf4llm markdown per page, plain text as the
    per-page fallback); pdfplumber is only tried when PyMuPDF cannot open the file.
    `deadline` is a `clock()` value, checked before each page.

    Reads pages [start, start + batch), never past max_pages. Page counts in the
    result and in `progress` are from the start of the book, so a later batch of a
    long PDF reports e.g. pages_read 600 of 812. Only the first batch (start 0) must
    find text; a later run of image-only pages just adds nothing.
    """
    pages = _PageRange(start, batch, max_pages)
    document = None
    if fitz is not None:
        try:
            document = _open_pymupdf(source)
        except Exception:
            document = None

    if document is None:
        try:
            result = _extract_with_pdfplumber(source, pages, progress, deadline, clock)
        except ParseTimeoutError:
            raise
        except Exception as exc:
            raise ValidationException(f"PDF text extraction failed: {exc}") from exc
    else:
        try:
            result = _extract_with_pymupdf(document, pages, progress, deadline, clock)
        finally:
            document.close()
            _flush_mupdf_store()

    if not result.text and start == 0:
        raise ValidationException("No text could be extracted from the PDF")
    return result


def _discard_late_result(task: asyncio.Future) -> None:
    # Retrieve the abandoned thread's outcome so asyncio does not log it as unhandled.
    if not task.cancelled():
        task.exception()


class _ProgressReporter:
    """Awaits on_progress on the event loop whenever the page counters have moved.

    The parse thread only writes plain ints; it never touches the loop or the DB.
    """

    def __init__(
        self,
        progress: ParseProgress,
        on_progress: Optional[Callable[[ParseProgress], Awaitable[None]]],
    ) -> None:
        self._progress = progress
        self._on_progress = on_progress
        self._last: Optional[tuple[int, Optional[int]]] = None

    async def report(self) -> None:
        if self._on_progress is None:
            return
        snapshot = (self._progress.pages_done, self._progress.pages_total)
        if snapshot == self._last:
            return
        self._last = snapshot
        try:
            await self._on_progress(ParseProgress(*snapshot))
        except Exception as exc:
            logger.warning("Could not record parse progress: %s", exc)


async def _run_parse_thread(fn: Callable[..., T], *args, reporter: Optional[_ProgressReporter] = None) -> T:
    """Run a parse in a worker thread, abandoning it after the hard stop.

    The between-pages deadline ends almost every slow parse. A thread stuck inside one
    C call cannot be killed, so past the grace period the caller gets the timeout error
    and the parse gate is released; whatever the thread returns later is dropped.
    With a reporter, progress is polled every _PROGRESS_POLL_S while the thread runs.
    """
    task = asyncio.ensure_future(asyncio.to_thread(fn, *args))
    hard_stop = time.monotonic() + PARSE_DEADLINE_S + PARSE_HARD_STOP_GRACE_S
    while True:
        wait_s = max(0.0, hard_stop - time.monotonic())
        if reporter is not None:
            wait_s = min(wait_s, _PROGRESS_POLL_S)
        done, _ = await asyncio.wait({task}, timeout=wait_s)
        if reporter is not None:
            await reporter.report()
        if task in done:
            return task.result()
        if time.monotonic() >= hard_stop:
            task.add_done_callback(_discard_late_result)
            logger.error("Parse thread still running past the hard stop; releasing the parse gate")
            raise ParseTimeoutError()


class FileService:
    async def extract_from_file(self, notes_file: UploadFile) -> tuple[str, str]:
        file_type = normalize_file_extension(notes_file.filename)
        if file_type not in ALLOWED_FILE_TYPES:
            raise ValidationException(_UNSUPPORTED_TYPE_MESSAGE)

        data = await notes_file.read()
        if len(data) > MAX_UPLOAD_FILE_SIZE_BYTES:
            raise ValidationException("Uploaded notes file is too large")
        if not data:
            raise ValidationException("Uploaded notes file is empty")

        async with _parse_gate():
            # The budget starts once the gate is ours, so time spent queued behind
            # another parse does not count against this file.
            deadline = time.monotonic() + PARSE_DEADLINE_S
            text = await _run_parse_thread(self._parse_bytes, data, file_type, deadline)
        return text, file_type

    async def extract_from_path(
        self,
        path: str,
        file_name: str,
        *,
        on_progress: Optional[Callable[[ParseProgress], Awaitable[None]]] = None,
        start_page: int = 0,
        max_pages: int = PDF_PAGE_CAP,
    ) -> ExtractionResult:
        """Parse a file already saved to disk (uploads are streamed to temp files).

        PDFs are opened straight from the path, so the raw bytes never sit in memory.
        on_progress is awaited once when the parse gets its slot (pages_done 0), then
        whenever the page counters move, at most every _PROGRESS_POLL_S.

        A PDF parse reads at most PDF_PAGE_CAP pages from start_page, never past
        max_pages; folder uploads call this once per batch to read long books.
        """
        file_type = normalize_file_extension(file_name)
        if file_type not in ALLOWED_FILE_TYPES:
            raise ValidationException(_UNSUPPORTED_TYPE_MESSAGE)
        size = os.path.getsize(path)
        if size > MAX_UPLOAD_FILE_SIZE_BYTES:
            raise ValidationException("Uploaded notes file is too large")
        if size == 0:
            raise ValidationException("Uploaded notes file is empty")

        progress = ParseProgress()
        reporter = _ProgressReporter(progress, on_progress)
        async with _parse_gate():
            await reporter.report()
            deadline = time.monotonic() + PARSE_DEADLINE_S
            return await _run_parse_thread(
                self._parse_path,
                path,
                file_type,
                progress,
                deadline,
                _PageRange(start_page, PDF_PAGE_CAP, max_pages),
                reporter=reporter,
            )

    def _parse_path(
        self, path: str, file_type: str, progress: ParseProgress, deadline: float, pages: _PageRange
    ) -> ExtractionResult:
        """Extract and clean text from a saved file. Runs in a worker thread."""
        if file_type == "pdf":
            pdf = _extract_pdf_pages(
                path, progress, deadline, start=pages.start, batch=pages.batch, max_pages=pages.max_pages
            )
            return ExtractionResult(_clean_extracted_text(pdf.text), file_type, pdf.pages_read, pdf.page_count)
        with open(path, "rb") as handle:
            data = handle.read()
        return ExtractionResult(self._parse_bytes(data, file_type, deadline), file_type)

    def _parse_bytes(self, data: bytes, file_type: str, deadline: Optional[float] = None) -> str:
        """Extract and clean text. Runs in a worker thread, inside the parse gate."""
        if file_type == "txt":
            return _clean_extracted_text(_decode_best_effort(data))
        if file_type == "md":
            return _clean_extracted_text(self._extract_markdown(data))
        if file_type in {"html", "htm"}:
            return _clean_extracted_text(self._extract_html(data))
        if file_type == "pptx":
            return _clean_extracted_text(self._extract_pptx(data))
        if file_type in _CODE_FILE_TYPES:
            return _clean_extracted_text(self._extract_code(data, file_type), preserve_code=True)
        if file_type == "docx":
            return _clean_extracted_text(self._extract_docx(data))
        return _clean_extracted_text(self._extract_pdf(data, deadline))

    async def extract_from_files(self, notes_files: list[UploadFile]) -> tuple[str, list[str]]:
        total_size_bytes = 0
        for notes_file in notes_files:
            try:
                file_bytes = await notes_file.read()
                total_size_bytes += len(file_bytes)
                await notes_file.seek(0)
            except TypeError:
                # Some tests pass lightweight doubles that don't provide async read/seek.
                # Real FastAPI UploadFile objects still go through byte-size validation.
                continue

        if total_size_bytes > MAX_UPLOAD_TOTAL_SIZE_BYTES:
            raise ValidationException(
                f"Combined uploaded files exceed the {MAX_UPLOAD_TOTAL_SIZE_BYTES // (1024 * 1024)} MB limit"
            )

        results = await asyncio.gather(*(self.extract_from_file(notes_file) for notes_file in notes_files))

        sections: list[str] = []
        file_types: list[str] = []
        for index, (content, file_type) in enumerate(results, start=1):
            file_types.append(file_type)
            sections.append(f"--- Document {index}: {notes_files[index - 1].filename or 'notes'} ---\n{content}")

        return "\n\n".join(sections), file_types

    async def extract_from_paths(self, files: list[tuple[str, str]]) -> tuple[str, list[str]]:
        """extract_from_files for uploads already saved to temp files: (path, name) pairs.

        The caller has already checked the combined size while saving them. Files are
        parsed in order; the parse gate would serialize them anyway.
        """
        sections: list[str] = []
        file_types: list[str] = []
        for index, (path, name) in enumerate(files, start=1):
            result = await self.extract_from_path(path, name)
            file_types.append(result.file_type)
            sections.append(f"--- Document {index}: {name or 'notes'} ---\n{result.text}")
        return "\n\n".join(sections), file_types

    async def get_folder_files_content(self, folder_id: int, user_id: int, session: AsyncSession) -> str:
        rows = await session.scalars(
            select(FolderFile)
            .join(Folder, Folder.id == FolderFile.folder_id)
            .where(FolderFile.folder_id == folder_id, Folder.user_id == user_id)
            .order_by(FolderFile.uploaded_at.desc())
        )
        files = list(rows.all())
        if not files:
            return ""

        sections: list[str] = []
        for folder_file in files:
            sections.append(f"[{folder_file.file_name}]\n{folder_file.content}")

        return "\n\n---\n\n".join(sections).strip()

    def _extract_docx(self, data: bytes) -> str:
        if python_docx is None:
            raise ValidationException(
                "python-docx is not installed. Run: pip install python-docx"
            )
        document = python_docx.Document(BytesIO(data))
        parts: list[str] = []
        for paragraph in document.paragraphs:
            text = paragraph.text.strip()
            if text:
                parts.append(text)
        for table in document.tables:
            for row in table.rows:
                row_text = "\t".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    parts.append(row_text)
        result = "\n".join(parts).strip()
        if not result:
            raise ValidationException("No text could be extracted from the DOCX file")
        return result

    def _extract_markdown(self, data: bytes) -> str:
        text = _decode_best_effort(data)
        # Strip frontmatter.
        text = re.sub(r"\A---\s*\n.*?\n---\s*\n", "", text, flags=re.DOTALL)
        # Convert links and images to readable text.
        text = re.sub(r"!\[[^\]]*\]\(([^)]+)\)", r"[image: \1]", text)
        text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", text)
        # Strip code fence markers but keep code content.
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*$", "", text, flags=re.MULTILINE)
        # Remove most markdown control chars while preserving wording.
        text = re.sub(r"^[>#\-*+]{1,3}\s*", "", text, flags=re.MULTILINE)
        return text.strip()

    def _extract_html(self, data: bytes) -> str:
        raw = _decode_best_effort(data)
        if BeautifulSoup is not None:
            soup = BeautifulSoup(raw, "html.parser")
            for tag in soup(["script", "style", "noscript"]):
                tag.extract()
            text = soup.get_text("\n")
            return html_lib.unescape(text).strip()
        # Fallback without BeautifulSoup.
        text = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", raw)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        return html_lib.unescape(text).strip()
    def _extract_
    def _extract_pptx(self, data: bytes) -> str:
        if Presentation is None:
            raise ValidationException(
                "python-pptx is not installed. Run: pip install python-pptx"
            )
        presentation = Presentation(BytesIO(data))
        parts: list[str] = []
        for slide_index, slide in enumerate(presentation.slides, start=1):
            slide_lines: list[str] = []
            for shape in slide.shapes:
                text = getattr(shape, "text", "")
                if text and str(text).strip():
                    slide_lines.append(str(text).strip())
            if slide_lines:
                parts.append(f"Slide {slide_index}\n" + "\n".join(slide_lines))
        result = "\n\n".join(parts).strip()
        if not result:
            raise ValidationException("No text could be extracted from the PPTX file")
        return result

    def _extract_code(self, data: bytes, file_type: str) -> str:
        text = _decode_best_effort(data)
        header = f"Code file ({file_type})"
        return f"{header}\n\n{text.strip()}"

    def _extract_pdf(self, data: bytes, deadline: Optional[float] = None) -> str:
        return _extract_pdf_pages(data, ParseProgress(), deadline=deadline).text
