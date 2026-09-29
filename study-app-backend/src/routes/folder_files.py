from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime
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
from src.services.file_service import FileService, ParseProgress
from src.services.kojo_context_cache import invalidate_folder
from src.services.upload_recovery import stopped_reading_note
from src.utils.logger import get_logger
from src.utils.process_memory import process_rss_mb
from src.utils.temp_uploads import UploadTooLargeError, remove_temp, save_upload_to_temp
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
    upload_note: Optional[str] = None
    pages_done: Optional[int] = None
    pages_total: Optional[int] = None
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


async def _record_progress(file_id: int, progress: ParseProgress) -> None:
    async with async_session_maker() as session:
        record = await session.get(FolderFile, file_id)
        if record is None:
            return
        record.pages_done = progress.pages_done
        record.pages_total = progress.pages_total
        await session.commit()


# Long PDFs are read in batches of PDF_PAGE_CAP pages, up to this many pages in all.
# The row is usable after the first batch; the rest is appended in the background.
PDF_BOOK_MAX_PAGES = 1500

# A batch starts only while the process is under this much resident memory (Render's
# box is 512 MB). Otherwise it waits, and gives up after the retries.
BATCH_MEMORY_CEILING_MB = 350
BATCH_MEMORY_RETRIES = 3
BATCH_MEMORY_RETRY_S = 60


def _page_note(pages_read: int, page_count: int, stopped: bool) -> Optional[str]:
    if pages_read >= page_count:
        return None
    if stopped:
        return stopped_reading_note(pages_read, page_count)
    return f"Read the first {pages_read} of {page_count} pages."


async def _record_batch_progress(file_id: int, progress: ParseProgress) -> None:
    # A later batch reports (0, None) when it gets the parse slot; the ready row
    # keeps its counters until real pages move.
    if progress.pages_total is None:
        return
    await _record_progress(file_id, progress)


async def _wait_for_memory_headroom() -> bool:
    for attempt in range(BATCH_MEMORY_RETRIES + 1):
        used_mb = process_rss_mb()
        if used_mb is None or used_mb < BATCH_MEMORY_CEILING_MB:
            return True
        logger.info("Next PDF batch waiting for memory: %.0f MB in use", used_mb)
        if attempt < BATCH_MEMORY_RETRIES:
            await asyncio.sleep(BATCH_MEMORY_RETRY_S)
    return False


async def _save_batch(
    file_id: int, folder_id: int, text: str, pages_read: int, pages_total: int, note: Optional[str]
) -> bool:
    """Append one batch's text to a ready row. False when the row is gone."""
    async with async_session_maker() as session:
        record = await session.get(FolderFile, file_id)
        if record is None:
            return False
        if text.strip():
            record.content = f"{record.content}\n\n{text}" if record.content else text
            record.content_hash = hashlib.sha256(record.content.encode("utf-8")).hexdigest()
            record.size_bytes = len(record.content.encode("utf-8"))
        # The boot sweep may have finalized this row during a deploy overlap; the
        # instance still reading it wins, as with a late first-batch result.
        record.upload_status = "ready"
        record.upload_error = None
        record.pages_done = pages_read
        record.pages_total = pages_total
        record.upload_note = note
        await session.commit()
    invalidate_folder(folder_id)
    return True


async def _read_remaining_batches(
    file_id: int, path: str, file_name: str, folder_id: int, pages_read: int, page_count: int
) -> None:
    """Read the rest of a long PDF one batch at a time into its (already ready) row.

    Each batch takes the parse gate on its own, so queued uploads run in between.
    A batch that fails, or memory that stays high, stops reading: the row keeps
    what was read and says how to get the rest.
    """
    total = min(page_count, PDF_BOOK_MAX_PAGES)
    while pages_read < total:
        stopped = not await _wait_for_memory_headroom()
        batch = None
        if not stopped:
            try:
                batch = await FileService().extract_from_path(
                    path,
                    file_name,
                    on_progress=lambda progress: _record_batch_progress(file_id, progress),
                    start_page=pages_read,
                    max_pages=PDF_BOOK_MAX_PAGES,
                )
            except Exception as exc:
                logger.warning("PDF batch from page %s failed for file_id=%s: %s", pages_read, file_id, exc)
            stopped = batch is None or not batch.pages_read or batch.pages_read <= pages_read
        if stopped:
            await _save_batch(file_id, folder_id, "", pages_read, pages_read, _page_note(pages_read, page_count, True))
            return
        pages_read = batch.pages_read
        done = pages_read >= total
        note = _page_note(pages_read, page_count, stopped=False) if done else None
        if not await _save_batch(file_id, folder_id, batch.text, pages_read, total, note):
            return


async def _extract_and_update(
    file_id: int,
    path: str,
    file_name: str,
    folder_id: int,
    user_id: int,
) -> None:
    """Background task: parse the uploaded temp file and update the folder_file record.

    No DB connection is held during the parse (it can take minutes); progress writes
    and the final update each use a short session. The temp file is always removed.
    """
    import time as _time
    _t0 = _time.monotonic()
    read_more_from: Optional[int] = None
    try:
        result = await FileService().extract_from_path(
            path,
            file_name,
            on_progress=lambda progress: _record_progress(file_id, progress),
            max_pages=PDF_BOOK_MAX_PAGES,
        )
        content = result.text
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        async with async_session_maker() as session:
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
                # A sweep may have marked this row failed while it was still parsing
                # (deploy overlap); the real result wins.
                record.upload_error = None
                record.upload_note = None
                if result.pages_read is not None and result.page_count is not None:
                    # pages_done < pages_total on a ready row means "still reading more".
                    total = min(result.page_count, PDF_BOOK_MAX_PAGES)
                    record.pages_done = result.pages_read
                    record.pages_total = max(total, result.pages_read)
                    if result.pages_read < total:
                        read_more_from = result.pages_read
                    else:
                        record.upload_note = _page_note(result.pages_read, result.page_count, stopped=False)

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

        if read_more_from is not None and result.page_count is not None:
            try:
                await _read_remaining_batches(
                    file_id, path, file_name, folder_id, read_more_from, result.page_count
                )
            except Exception as exc:
                # The row is ready with the pages read so far; the next boot sweep
                # adds the note.
                logger.warning("Reading later PDF batches failed for file_id=%s: %s", file_id, exc)
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
    finally:
        remove_temp(path)


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


# The viewer only needs enough text to confirm the right file was parsed.
# Capping the payload keeps multi-MB PDFs from freezing the browser tab.
MAX_VIEW_CONTENT_CHARS = 200_000


class FolderFileContentResponse(BaseModel):
    id: int
    file_name: str
    file_type: str
    content: str
    truncated: bool
    # Both counts are computed server-side: JS string length counts UTF-16
    # units, so emoji would skew a client-side count.
    shown_chars: int
    total_chars: int


@router.get("/{folder_id}/files/{file_id}/content", response_model=FolderFileContentResponse)
async def get_folder_file_content(
    folder_id: int,
    file_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderFileContentResponse:
    await _get_owned_folder(folder_id, user, session)
    record = await session.scalar(
        select(FolderFile).where(FolderFile.id == file_id, FolderFile.folder_id == folder_id)
    )
    if record is None:
        raise HTTPException(status_code=404, detail="File not found")
    if record.upload_status in ("processing", "error"):
        raise HTTPException(status_code=400, detail="This file has no parsed text to show yet.")

    content = record.content or ""
    shown = content[:MAX_VIEW_CONTENT_CHARS]
    return FolderFileContentResponse(
        id=record.id,
        file_name=record.file_name,
        file_type=record.file_type,
        content=shown,
        truncated=len(content) > MAX_VIEW_CONTENT_CHARS,
        shown_chars=len(shown),
        total_chars=len(content),
    )


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
    # Temp files handed to background tasks; removed here if the request fails first.
    queued_paths: list[str] = []

    try:
        for upload in files:
            name = upload.filename or "untitled"
            file_type = normalize_file_extension(name)

            if file_type not in ALLOWED_FILE_TYPES:
                skipped.append(SkippedFile(
                    file_name=name,
                    reason="Supported file types: PDF, DOCX, TXT, MD, HTML, PPTX, and common code files",
                ))
                continue

            # Stream to a temp file NOW, before the request context ends. The bytes
            # never sit in memory for the length of the background parse.
            try:
                saved = await save_upload_to_temp(upload, MAX_UPLOAD_FILE_SIZE_BYTES)
            except UploadTooLargeError:
                skipped.append(SkippedFile(
                    file_name=name,
                    reason=f"Exceeds {MAX_UPLOAD_FILE_SIZE_BYTES // (1024 * 1024)} MB per-file limit",
                ))
                continue
            if saved.size == 0:
                remove_temp(saved.path)
                skipped.append(SkippedFile(file_name=name, reason="File is empty"))
                continue
            if current_total_bytes + pending_total_bytes + saved.size > MAX_UPLOAD_TOTAL_SIZE_BYTES:
                remove_temp(saved.path)
                skipped.append(SkippedFile(
                    file_name=name,
                    reason=f"Adding this file would exceed the {MAX_UPLOAD_TOTAL_SIZE_BYTES // (1024 * 1024)} MB folder limit",
                ))
                continue

            # Reject an exact re-upload before it spends minutes in the single parse
            # slot. Failed rows don't count, so re-uploading a failed file works.
            duplicate = await session.scalar(
                select(FolderFile).where(
                    FolderFile.folder_id == folder_id,
                    FolderFile.raw_hash == saved.sha256,
                    FolderFile.upload_status.in_(("ready", "processing")),
                )
            )
            if duplicate is not None:
                remove_temp(saved.path)
                skipped.append(SkippedFile(
                    file_name=name,
                    reason=f"Identical file already exists as '{duplicate.file_name}'",
                ))
                continue

            pending_total_bytes += saved.size

            # Insert a placeholder record immediately so the frontend can display it.
            record = FolderFile(
                folder_id=folder.id,
                file_name=name,
                file_type=file_type,
                size_bytes=saved.size,
                content="",
                content_hash="",
                raw_hash=saved.sha256,
                upload_status="processing",
            )
            session.add(record)
            await session.flush()

            # Schedule text extraction in the background; user can navigate away.
            queued_paths.append(saved.path)
            background_tasks.add_task(_extract_and_update, record.id, saved.path, name, folder_id, user.id)

            created.append(FolderFileResponse.model_validate(record))
            logger.info(
                "File queued for background extraction",
                extra={"upload_filename": name, "file_type": file_type, "folder_id": folder_id},
            )

        await session.commit()
    except BaseException:
        for path in queued_paths:
            remove_temp(path)
        raise
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
