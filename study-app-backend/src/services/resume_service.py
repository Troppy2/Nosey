"""Resume text for mock interviews.

Two jobs: turn an upload or a paste into bounded plain text, and keep the one
saved resume per user (users.saved_resume_*) that the ATS screen can reuse.
Stateless module functions, no LLM calls.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User
from src.services.file_service import FileService
from src.utils.exceptions import ValidationException

# Resumes are short. The bound keeps the ATS prompt and the stored copy small and
# matches what mock_interview_sessions.resume_text has always held.
MAX_RESUME_CHARS = 12000
MIN_RESUME_CHARS = 40

NO_RESUME_MESSAGE = "Please provide a resume: upload a PDF/DOCX or paste your resume text or LaTeX."


@dataclass
class SavedResume:
    text: str
    file_name: Optional[str]
    updated_at: Optional[datetime]


async def extract_resume_text(
    resume_file: Optional[UploadFile], resume_text: Optional[str]
) -> tuple[str, Optional[str]]:
    """Text and file name from an upload (preferred) or pasted text.

    Raises ValidationException when the result is too short to be a resume.
    Anything else FileService raises (an unreadable file) propagates.
    """
    text = ""
    file_name: Optional[str] = None
    if resume_file is not None and resume_file.filename:
        file_name = resume_file.filename[:255]
        text, _ = await FileService().extract_from_file(resume_file)
    elif resume_text:
        text = resume_text
    text = (text or "").strip()
    if len(text) < MIN_RESUME_CHARS:
        raise ValidationException(NO_RESUME_MESSAGE)
    return text[:MAX_RESUME_CHARS], file_name


async def load_saved_resume(db: AsyncSession, user_id: int) -> Optional[SavedResume]:
    """The user's saved resume, or None. Selects the columns directly because
    saved_resume_text is deferred on the model."""
    row = (
        await db.execute(
            select(
                User.saved_resume_text,
                User.saved_resume_file_name,
                User.saved_resume_updated_at,
            ).where(User.id == user_id)
        )
    ).one_or_none()
    if row is None or not (row.saved_resume_text or "").strip():
        return None
    return SavedResume(
        text=row.saved_resume_text,
        file_name=row.saved_resume_file_name,
        updated_at=row.saved_resume_updated_at,
    )


def store_saved_resume(user: User, text: str, file_name: Optional[str]) -> datetime:
    """Replace the user's saved resume. The caller commits."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    user.saved_resume_text = text[:MAX_RESUME_CHARS]
    user.saved_resume_file_name = file_name
    user.saved_resume_updated_at = now
    return now


def clear_saved_resume(user: User) -> None:
    """Forget the user's saved resume. The caller commits."""
    user.saved_resume_text = None
    user.saved_resume_file_name = None
    user.saved_resume_updated_at = None
