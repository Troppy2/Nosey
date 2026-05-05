from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.user import User
from src.services.file_service import FileService
from src.utils.exceptions import ValidationException
from src.utils.validators import MAX_UPLOAD_TOTAL_SIZE_BYTES

router = APIRouter(prefix="/folders", tags=["folder-files"])


class FolderFileResponse(BaseModel):
    id: int
    folder_id: int
    file_name: str
    file_type: str
    size_bytes: int
    uploaded_at: datetime

    model_config = {"from_attributes": True}


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
    response_model=list[FolderFileResponse],
    status_code=status.HTTP_201_CREATED,
)
async def upload_folder_files(
    folder_id: int,
    files: list[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FolderFileResponse]:
    from src.utils.logger import logger
    
    folder = await _get_owned_folder(folder_id, user, session)

    from sqlalchemy import func as sqlfunc
    current_total_result = await session.scalar(
        select(sqlfunc.coalesce(sqlfunc.sum(FolderFile.size_bytes), 0)).where(FolderFile.folder_id == folder_id)
    )
    current_total_bytes = int(current_total_result or 0)

    svc = FileService()
    created: list[FolderFileResponse] = []
    pending_total_bytes = 0
    for upload in files:
        try:
            content, file_type = await svc.extract_from_file(upload)
            logger.info(
                "File extracted successfully",
                extra={
                    "filename": upload.filename,
                    "file_type": file_type,
                    "content_length": len(content),
                    "folder_id": folder_id,
                    "user_id": user.id,
                }
            )
        except ValidationException as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        # Read the raw size — file has already been read in extract_from_file so use content length
        size_bytes = len(content.encode("utf-8"))

        if current_total_bytes + pending_total_bytes + size_bytes > MAX_UPLOAD_TOTAL_SIZE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Folder materials exceed total storage limit "
                    f"({MAX_UPLOAD_TOTAL_SIZE_BYTES // (1024 * 1024)} MB)."
                ),
            )
        pending_total_bytes += size_bytes

        record = FolderFile(
            folder_id=folder.id,
            file_name=upload.filename or "untitled",
            file_type=file_type,
            size_bytes=size_bytes,
            content=content,
        )
        session.add(record)
        await session.flush()
        created.append(FolderFileResponse.model_validate(record))

    await session.commit()
    return created


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
