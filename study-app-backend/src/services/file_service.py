from __future__ import annotations

import asyncio
from io import BytesIO

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


class FileService:
    async def extract_from_file(self, notes_file: UploadFile) -> tuple[str, str]:
        file_type = normalize_file_extension(notes_file.filename)
        if file_type not in ALLOWED_FILE_TYPES:
            raise ValidationException("Only PDF, TXT, and MD notes are supported")

        data = await notes_file.read()
        if len(data) > MAX_UPLOAD_FILE_SIZE_BYTES:
            raise ValidationException("Uploaded notes file is too large")
        if not data:
            raise ValidationException("Uploaded notes file is empty")

        if file_type in {"txt", "md"}:
            return data.decode("utf-8", errors="ignore").strip(), file_type
        return await asyncio.to_thread(self._extract_pdf, data), file_type

    async def extract_from_files(self, notes_files: list[UploadFile]) -> tuple[str, list[str]]:
        if len(notes_files) > MAX_UPLOAD_DOCUMENTS:
            raise ValidationException(f"You can upload at most {MAX_UPLOAD_DOCUMENTS} documents")

        sections: list[str] = []
        file_types: list[str] = []
        for index, notes_file in enumerate(notes_files, start=1):
            content, file_type = await self.extract_from_file(notes_file)
            file_types.append(file_type)
            sections.append(f"--- Document {index}: {notes_file.filename or 'notes'} ---\n{content}")

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

    def _extract_pdf(self, data: bytes) -> str:
        with pdfplumber.open(BytesIO(data)) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        stripped = text.strip()
        if not stripped:
            raise ValidationException("No text could be extracted from the PDF")
        return stripped
