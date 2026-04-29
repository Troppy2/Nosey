from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.attempt_schema import AttemptDetail, AttemptResult, AttemptSummary, SubmitAttemptRequest
from src.services.grading_service import GradingService
from src.utils.exceptions import ResourceNotFoundException, StudyAppException

router = APIRouter(tags=["attempts"])


@router.post("/tests/{test_id}/attempts", response_model=AttemptResult)
async def submit_attempt(
    test_id: int,
    request: SubmitAttemptRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> AttemptResult:
    try:
        return await GradingService().submit_and_grade(test_id, user.id, request.answers, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tests/{test_id}/attempts", response_model=list[AttemptSummary])
async def list_attempts(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[AttemptSummary]:
    try:
        return await GradingService().list_attempts(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/tests/{test_id}/attempts/{attempt_id}", response_model=AttemptDetail)
async def get_attempt_detail(
    test_id: int,
    attempt_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> AttemptDetail:
    _ = test_id
    try:
        return await GradingService().get_attempt_detail(attempt_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
