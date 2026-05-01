from __future__ import annotations

import asyncio
import os
from concurrent.futures import ProcessPoolExecutor
from io import BytesIO
from itertools import repeat
from multiprocessing import get_context
from typing import Callable, Optional

import pdfplumber
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.folder_file import FolderFile
from src.utils.exceptions import ValidationException
from src.utils.validators import (
    ALLOWED_FILE_TYPES,
    MAX_UPLOAD_DOCUMENTS,
    MAX_UPLOAD_FILE_SIZE_BYTES,
    normalize_file_extension,
)

try:
    import fitz  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependency
    fitz = None  # type: ignore[assignment]

try:
    import docx as python_docx  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional dependency
    python_docx = None  # type: ignore[assignment]


def _preferred_pdf_workers() -> int:
    return max(1, min(os.cpu_count() or 1, 4))


def _chunk_page_indexes(page_count: int, worker_count: int) -> list[list[int]]:
    if page_count <= 0:
        return []

    worker_count = max(1, min(worker_count, page_count))
    chunk_size = max(1, (page_count + worker_count - 1) // worker_count)
    return [list(range(start, min(start + chunk_size, page_count))) for start in range(0, page_count, chunk_size)]


def _join_extracted_chunks(chunks: list[str]) -> str:
    return "\n".join(chunk.strip() for chunk in chunks if chunk and chunk.strip()).strip()


def _extract_pdfplumber_chunk(data: bytes, page_indexes: list[int]) -> str:
    with pdfplumber.open(BytesIO(data)) as pdf:
        return _extract_pdfplumber_serial(pdf, page_indexes)


def _extract_pdfplumber_serial(pdf, page_indexes: list[int]) -> str:
    pages = pdf.pages
    parts: list[str] = []
    for page_index in page_indexes:
        if page_index < len(pages):
            parts.append(pages[page_index].extract_text() or "")
    return "\n".join(parts)


def _extract_pymupdf_chunk(data: bytes, page_indexes: list[int]) -> str:
    if fitz is None:
        raise ImportError("PyMuPDF is not installed")

    document = fitz.open(stream=data, filetype="pdf")
    try:
        return _extract_pymupdf_serial(document, page_indexes)
    finally:
        document.close()


def _extract_pymupdf_serial(document, page_indexes: list[int]) -> str:
    parts: list[str] = []
    for page_index in page_indexes:
        if page_index < document.page_count:
            parts.append(document.load_page(page_index).get_text("text") or "")
    return "\n".join(parts)


class FileService:
    async def extract_from_file(self, notes_file: UploadFile) -> tuple[str, str]:
        file_type = normalize_file_extension(notes_file.filename)
        if file_type not in ALLOWED_FILE_TYPES:
            raise ValidationException("Only PDF, DOCX, TXT, and MD notes are supported")

        data = await notes_file.read()
        if len(data) > MAX_UPLOAD_FILE_SIZE_BYTES:
            raise ValidationException("Uploaded notes file is too large")
        if not data:
            raise ValidationException("Uploaded notes file is empty")

        if file_type in {"txt", "md"}:
            return data.decode("utf-8", errors="ignore").strip(), file_type
        if file_type == "docx":
            return await asyncio.to_thread(self._extract_docx, data), file_type
        return await asyncio.to_thread(self._extract_pdf, data), file_type

    async def extract_from_files(self, notes_files: list[UploadFile]) -> tuple[str, list[str]]:
        if len(notes_files) > MAX_UPLOAD_DOCUMENTS:
            raise ValidationException(f"You can upload at most {MAX_UPLOAD_DOCUMENTS} documents")

        results = await asyncio.gather(*(self.extract_from_file(notes_file) for notes_file in notes_files))

        sections: list[str] = []
        file_types: list[str] = []
        for index, (content, file_type) in enumerate(results, start=1):
            file_types.append(file_type)
            sections.append(f"--- Document {index}: {notes_files[index - 1].filename or 'notes'} ---\n{content}")

        return "\n\n".join(sections), file_types

    async def get_folder_files_content(self, folder_id: int, session: AsyncSession) -> str:
        rows = await session.scalars(
            select(FolderFile)
            .where(FolderFile.folder_id == folder_id)
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

    def _extract_pdf(self, data: bytes) -> str:
        attempts: list[tuple[str, Callable[[bytes], str]]] = []
        if fitz is not None:
            attempts.append(("PyMuPDF", self._extract_pdf_with_pymupdf))
        attempts.append(("pdfplumber", self._extract_pdf_with_pdfplumber))

        last_error: Optional[Exception] = None
        for engine_name, extractor in attempts:
            try:
                text = extractor(data)
            except Exception as exc:
                last_error = exc
                continue

            stripped = text.strip()
            if stripped:
                return stripped

            last_error = ValidationException(f"{engine_name} could not extract any text from the PDF")

        if last_error is not None:
            raise ValidationException(f"PDF text extraction failed: {last_error}") from last_error
        raise ValidationException("No text could be extracted from the PDF")

    def _extract_pdf_with_pdfplumber(self, data: bytes) -> str:
        with pdfplumber.open(BytesIO(data)) as pdf:
            page_count = len(pdf.pages)
            page_groups = _chunk_page_indexes(page_count, _preferred_pdf_workers())
            if len(page_groups) <= 1:
                return _extract_pdfplumber_serial(pdf, page_groups[0] if page_groups else list(range(page_count)))

        return self._extract_pdf_in_parallel(data, page_count, _extract_pdfplumber_chunk)

    def _extract_pdf_with_pymupdf(self, data: bytes) -> str:
        if fitz is None:
            raise ImportError("PyMuPDF is not installed")

        document = fitz.open(stream=data, filetype="pdf")
        try:
            page_count = int(document.page_count)
            page_groups = _chunk_page_indexes(page_count, _preferred_pdf_workers())
            if len(page_groups) <= 1:
                return _extract_pymupdf_serial(document, page_groups[0] if page_groups else list(range(page_count)))
        finally:
            document.close()

        return self._extract_pdf_in_parallel(data, page_count, _extract_pymupdf_chunk)

    def _extract_pdf_in_parallel(self, data: bytes, page_count: int, worker) -> str:
        if page_count <= 0:
            raise ValidationException("No text could be extracted from the PDF")

        worker_count = _preferred_pdf_workers()
        page_groups = _chunk_page_indexes(page_count, worker_count)
        if len(page_groups) <= 1:
            return worker(data, page_groups[0] if page_groups else list(range(page_count)))

        with ProcessPoolExecutor(max_workers=len(page_groups), mp_context=get_context("spawn")) as executor:
            chunks = list(executor.map(worker, repeat(data), page_groups))
        return _join_extracted_chunks(list(chunks))
