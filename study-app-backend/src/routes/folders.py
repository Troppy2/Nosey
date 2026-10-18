from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.folder_schema import FolderCreate, FolderResponse, FolderUpdate
from src.schemas.folder_stats_schema import FolderStatsResponse
from src.services.folder_service import FolderService
from src.services.folder_stats_service import FolderStatsService
from src.utils.exceptions import ResourceNotFoundException, StudyAppException
from src.services.account_safety_service import screen_user_input

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
    await screen_user_input(user, "folder", data.name, data.subject, data.description)
    try:
        return await FolderService().create_folder(user.id, data, session)
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/archived", response_model=list[FolderResponse])
async def list_archived_folders(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FolderResponse]:
    return await FolderService().list_archived_folders(user.id, session)


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


@router.get("/{folder_id}/stats", response_model=FolderStatsResponse)
async def get_folder_stats(
    folder_id: int,
    tz_offset_minutes: int = Query(default=0, ge=-840, le=840),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderStatsResponse:
    try:
        return await FolderStatsService().get_stats(folder_id, user.id, session, tz_offset_minutes)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: int,
    data: FolderUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderResponse:
    await screen_user_input(
        user, "folder", data.name, data.subject, data.description, data.kojo_persona, data.test_instructions
    )
    try:
        return await FolderService().update_folder(folder_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
