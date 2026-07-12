from __future__ import annotations

import hashlib
from datetime import datetime
from io import BytesIO

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session, async_session_maker
from src.dependencies import get_current_user
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.services.file_service import FileService
from src.services.kojo_context_cache import invalidate_folder
from src.utils.exceptions import ValidationException
from src.utils.logger import get_logger
from src.utils.validators import (
    ALLOWED_FILE_TYPES,
    MAX_UPLOAD_FILE_SIZE_BYTES,
    MAX_UPLOAD_TOTAL_SIZE_BYTES,
    normalize_file_extension,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/folders", tags=["folder-files"])


class FolderFileResponse(BaseModel):
    id: int
    folder_id: int
    file_name: str
    file_type: str
    size_bytes: int
    upload_status: Optional[str] = None
    upload_error: Optional[str] = None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class SkippedFile(BaseModel):
    file_name: str
    reason: str


class UploadResult(BaseModel):
    uploaded: list[FolderFileResponse]
    skipped: list[SkippedFile]


async def _get_owned_folder(
    folder_id: int,
    user: User,
    session: AsyncSession,
) -> Folder:
    folder = await session.scalar(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == user.id)
    )
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


class _BytesUploadFile:
    """Minimal UploadFile stand-in backed by in-memory bytes for background tasks."""

    def __init__(self, data: bytes, filename: str) -> None:
        self._data = data
        self.filename = filename

    async def read(self) -> bytes:
        return self._data


async def _extract_and_update(
    file_id: int,
    data: bytes,
    file_name: str,
    file_type: str,
    folder_id: int,
    user_id: int,
) -> None:
    """Background task: extract text from bytes and update the folder_file record."""
    import time as _time
    _t0 = _time.monotonic()
    async with async_session_maker() as session:
        try:
            svc = FileService()
            mock_file = _BytesUploadFile(data, file_name)
            content, _ = await svc.extract_from_file(mock_file)  # type: ignore[arg-type]

            content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

            duplicate = await session.scalar(
                select(FolderFile).where(
                    FolderFile.folder_id == folder_id,
                    FolderFile.content_hash == content_hash,
                    FolderFile.id != file_id,
                )
            )

            record = await session.get(FolderFile, file_id)
            if record is None:
                return

            if duplicate is not None:
                record.upload_status = "error"
                record.upload_error = f"Identical content already exists as '{duplicate.file_name}'"
            else:
                record.content = content
                record.content_hash = content_hash
                record.size_bytes = len(content.encode("utf-8"))
                record.upload_status = "ready"

            duration_ms = int((_time.monotonic() - _t0) * 1000)
            success = record.upload_status == "ready"
            error_label = "duplicate_content" if not success else None
            try:
                await UsageEventRepository(session).log_event(
                    user_id, "file_upload", duration_ms,
                    success=success, error_type=error_label
                )
            except Exception:
                pass
            await session.commit()
            invalidate_folder(folder_id)
            logger.info(
                "Background extraction complete",
                extra={"file_id": file_id, "file_name": file_name, "status": record.upload_status},
            )
        except Exception as exc:
            logger.warning("Background extraction failed for file_id=%s: %s", file_id, exc)
            duration_ms = int((_time.monotonic() - _t0) * 1000)
            async with async_session_maker() as err_session:
                record = await err_session.get(FolderFile, file_id)
                if record is not None:
                    record.upload_status = "error"
                    record.upload_error = str(exc)[:500]
                try:
                    await UsageEventRepository(err_session).log_event(
                        user_id, "file_upload", duration_ms,
                        success=False, error_type=type(exc).__name__[:50]
                    )
                except Exception:
                    pass
                await err_session.commit()


@router.get("/{folder_id}/files", response_model=list[FolderFileResponse])
async def list_folder_files(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FolderFileResponse]:
    await _get_owned_folder(folder_id, user, session)
    rows = await session.scalars(
        select(FolderFile)
        .where(FolderFile.folder_id == folder_id)
        .order_by(FolderFile.uploaded_at.desc())
    )
    return [FolderFileResponse.model_validate(r) for r in rows]


@router.post(
    "/{folder_id}/files",
    response_model=UploadResult,
    status_code=status.HTTP_201_CREATED,
)
async def upload_folder_files(
    folder_id: int,
    files: list[UploadFile] = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> UploadResult:
    folder = await _get_owned_folder(folder_id, user, session)

    from sqlalchemy import func as sqlfunc
    current_total_result = await session.scalar(
        select(sqlfunc.coalesce(sqlfunc.sum(FolderFile.size_bytes), 0)).where(FolderFile.folder_id == folder_id)
    )
    current_total_bytes = int(current_total_result or 0)

    created: list[FolderFileResponse] = []
    skipped: list[SkippedFile] = []
    pending_total_bytes = 0

    for upload in files:
        name = upload.filename or "untitled"
        file_type = normalize_file_extension(name)

        if file_type not in ALLOWED_FILE_TYPES:
            skipped.append(SkippedFile(
                file_name=name,
                reason="Supported file types: PDF, DOCX, TXT, MD, HTML, PPTX, and common code files",
            ))
            continue

        # Read bytes NOW before the request context ends.
        data = await upload.read()
        if not data:
            skipped.append(SkippedFile(file_name=name, reason="File is empty"))
            continue
        if len(data) > MAX_UPLOAD_FILE_SIZE_BYTES:
            skipped.append(SkippedFile(
                file_name=name,
                reason=f"Exceeds {MAX_UPLOAD_FILE_SIZE_BYTES // (1024 * 1024)} MB per-file limit",
            ))
            continue
        if current_total_bytes + pending_total_bytes + len(data) > MAX_UPLOAD_TOTAL_SIZE_BYTES:
            skipped.append(SkippedFile(
                file_name=name,
                reason=f"Adding this file would exceed the {MAX_UPLOAD_TOTAL_SIZE_BYTES // (1024 * 1024)} MB folder limit",
            ))
            continue

        pending_total_bytes += len(data)

        # Insert a placeholder record immediately so the frontend can display it.
        record = FolderFile(
            folder_id=folder.id,
            file_name=name,
            file_type=file_type,
            size_bytes=len(data),
            content="",
            content_hash="",
            upload_status="processing",
        )
        session.add(record)
        await session.flush()

        # Schedule text extraction in the background — user can navigate away.
        background_tasks.add_task(_extract_and_update, record.id, data, name, file_type, folder_id, user.id)

        created.append(FolderFileResponse.model_validate(record))
        logger.info(
            "File queued for background extraction",
            extra={"upload_filename": name, "file_type": file_type, "folder_id": folder_id},
        )

    await session.commit()
    if created:
        invalidate_folder(folder_id)
    return UploadResult(uploaded=created, skipped=skipped)


class TextNoteRequest(BaseModel):
    title: Optional[str] = None
    content: str


@router.post(
    "/{folder_id}/files/text",
    response_model=FolderFileResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_folder_text_note(
    folder_id: int,
    payload: TextNoteRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderFileResponse:
    folder = await _get_owned_folder(folder_id, user, session)

    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Note text cannot be empty.")

    content_bytes = len(content.encode("utf-8"))
    if content_bytes > MAX_UPLOAD_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Note exceeds the {MAX_UPLOAD_FILE_SIZE_BYTES // (1024 * 1024)} MB per-file limit.",
        )

    from sqlalchemy import func as sqlfunc
    current_total_result = await session.scalar(
        select(sqlfunc.coalesce(sqlfunc.sum(FolderFile.size_bytes), 0)).where(FolderFile.folder_id == folder_id)
    )
    current_total_bytes = int(current_total_result or 0)
    if current_total_bytes + content_bytes > MAX_UPLOAD_TOTAL_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Adding this note would exceed the {MAX_UPLOAD_TOTAL_SIZE_BYTES // (1024 * 1024)} MB folder limit.",
        )

    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    duplicate = await session.scalar(
        select(FolderFile).where(
            FolderFile.folder_id == folder_id,
            FolderFile.content_hash == content_hash,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Identical content already exists as '{duplicate.file_name}'.",
        )

    title = (payload.title or "").strip()
    if not title:
        first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
        if first_line:
            title = first_line[:60]
        else:
            title = f"Note - {datetime.now().strftime('%b %d, %Y')}"
    title = title[:255]

    record = FolderFile(
        folder_id=folder.id,
        file_name=title,
        file_type="txt",
        size_bytes=content_bytes,
        content=content,
        content_hash=content_hash,
        upload_status="ready",
    )
    session.add(record)
    await session.flush()

    try:
        await UsageEventRepository(session).log_event(user.id, "file_upload", 0, success=True)
    except Exception:
        pass

    await session.commit()
    invalidate_folder(folder_id)
    logger.info(
        "Text note added to folder",
        extra={"file_name": title, "folder_id": folder_id, "size_bytes": content_bytes},
    )
    return FolderFileResponse.model_validate(record)


class ReindexResult(BaseModel):
    reindexed: int
    still_failed: int


@router.post("/{folder_id}/files/reindex", response_model=ReindexResult)
async def reindex_folder_files(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ReindexResult:
    await _get_owned_folder(folder_id, user, session)
    rows = await session.scalars(
        select(FolderFile).where(
            FolderFile.folder_id == folder_id,
            FolderFile.upload_status != "ready",
        )
    )
    files = list(rows.all())
    reindexed = 0
    still_failed = 0
    for f in files:
        if f.content and f.content.strip():
            f.upload_status = "ready"
            f.upload_error = None
            reindexed += 1
        else:
            still_failed += 1
    if reindexed:
        await session.commit()
    return ReindexResult(reindexed=reindexed, still_failed=still_failed)


@router.delete("/{folder_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_folder_file(
    folder_id: int,
    file_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await _get_owned_folder(folder_id, user, session)
    result = await session.execute(
        delete(FolderFile).where(
            FolderFile.id == file_id,
            FolderFile.folder_id == folder_id,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="File not found")
    await session.commit()
    invalidate_folder(folder_id)
