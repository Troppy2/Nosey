from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.flashcard_schema import (
    FlashcardAttemptCreate,
    FlashcardCreate,
    FlashcardGenerateRequest,
    FlashcardResponse,
    FlashcardUpdate,
)
from src.services.flashcard_service import FlashcardService
from src.utils.exceptions import ResourceNotFoundException, StudyAppException

router = APIRouter(tags=["flashcards"])


@router.get("/flashcards", response_model=list[FlashcardResponse])
async def list_all_flashcards(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    return await FlashcardService().list_flashcards_for_user(user.id, session)


@router.post(
    "/folders/{folder_id}/flashcards",
    response_model=FlashcardResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_flashcard(
    folder_id: int,
    data: FlashcardCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FlashcardResponse:
    try:
        return await FlashcardService().create_flashcard(folder_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/flashcards/generate", response_model=list[FlashcardResponse])
async def generate_flashcards(
    folder_id: int,
    data: FlashcardGenerateRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    try:
        service = FlashcardService()
        if data.source_type == "test":
            return await service.generate_from_test(folder_id, data.test_id or 0, user.id, data.count, session)
        return await service.generate_from_prompt(folder_id, user.id, data.prompt or "", data.count, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/folders/{folder_id}/flashcards", response_model=list[FlashcardResponse])
async def list_flashcards(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    try:
        return await FlashcardService().list_flashcards(folder_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/folders/{folder_id}/flashcards/weak", response_model=list[FlashcardResponse])
async def weak_flashcards(
    folder_id: int,
    threshold: float = Query(default=0.5, ge=0.0, le=1.0),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    try:
        return await FlashcardService().get_weak_flashcards(folder_id, user.id, threshold, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/flashcards/generate-from-file", response_model=list[FlashcardResponse])
async def generate_flashcards_from_file(
    folder_id: int,
    notes_files: list[UploadFile] = File(...),
    count: int = Query(default=10, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    try:
        return await FlashcardService().generate_from_file(folder_id, user.id, notes_files, count, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/folders/{folder_id}/flashcards/{flashcard_id}", response_model=FlashcardResponse)
async def update_flashcard(
    folder_id: int,
    flashcard_id: int,
    data: FlashcardUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FlashcardResponse:
    try:
        return await FlashcardService().update_flashcard(folder_id, flashcard_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/folders/{folder_id}/flashcards/{flashcard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flashcard(
    folder_id: int,
    flashcard_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await FlashcardService().delete_flashcard(folder_id, flashcard_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/flashcards/{flashcard_id}/attempt", response_model=FlashcardResponse)
async def record_flashcard_attempt(
    folder_id: int,
    flashcard_id: int,
    data: FlashcardAttemptCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FlashcardResponse:
    try:
        return await FlashcardService().record_attempt(
            folder_id,
            flashcard_id,
            user.id,
            data.correct,
            data.time_ms,
            session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
