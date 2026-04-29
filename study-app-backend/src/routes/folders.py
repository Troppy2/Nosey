from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.folder_schema import FolderCreate, FolderResponse, FolderUpdate
from src.services.folder_service import FolderService
from src.utils.exceptions import ResourceNotFoundException, StudyAppException

router = APIRouter(prefix="/folders", tags=["folders"])


@router.get("", response_model=list[FolderResponse])
async def list_folders(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FolderResponse]:
    return await FolderService().list_folders(user.id, session)


@router.post("", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    data: FolderCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderResponse:
    try:
        return await FolderService().create_folder(user.id, data, session)
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{folder_id}", response_model=FolderResponse)
async def get_folder(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderResponse:
    try:
        return await FolderService().get_folder(folder_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: int,
    data: FolderUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderResponse:
    try:
        return await FolderService().update_folder(folder_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await FolderService().delete_folder(folder_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
