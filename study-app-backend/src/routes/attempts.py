import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.schemas.attempt_schema import (
    AttemptDetail,
    AttemptResult,
    AttemptSummary,
    DraftAttemptResponse,
    ResumableTestInfo,
    ReviewSummaryResponse,
    SaveDraftAttemptRequest,
    SubmitAttemptRequest,
)
from src.services.grading_service import GradingService
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ResourceNotFoundException, StudyAppException
from src.utils.provider_policy import can_submit_scratch_pad_work, resolve_ocr_engine

router = APIRouter(tags=["attempts"])


@router.post("/tests/{test_id}/attempts", response_model=AttemptResult)
# A submission can trigger up to 6 vision calls (STEM Scratch Pad feature),
# so this route gets a rate limit for the first time; attempts.py previously
# had none.
@limiter.limit("10/minute;60/hour")
async def submit_attempt(
    test_id: int,
    request: Request,
    response: Response,
    body: SubmitAttemptRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> AttemptResult:
    _t0 = time.monotonic()
    try:
        # Beta gate for the scratch-pad feature: a work_image from a
        # non-beta/non-admin user is rejected outright, before engine
        # selection or grading. This is the route boundary
        # resolve_ocr_engine's own docstring calls for.
        if not can_submit_scratch_pad_work(user) and any(a.work_image for a in body.answers):
            raise StudyAppException(
                "Scratch-pad drawings are a beta feature. Type your answer instead."
            )
        ocr_engine = resolve_ocr_engine(user, body.ocr_engine)

        result = await GradingService().submit_and_grade(
            test_id, user.id, body.answers, session, ocr_engine=ocr_engine
        )
        duration_ms = int((time.monotonic() - _t0) * 1000)
        try:
            await UsageEventRepository(session).log_event(user.id, "test_grading", duration_ms)
            await session.commit()
        except Exception:
            pass
        return result
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/tests/{test_id}/attempts/draft", response_model=DraftAttemptResponse)
async def save_draft_attempt(
    test_id: int,
    request: SaveDraftAttemptRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DraftAttemptResponse:
    """Save current progress on a test without submitting/grading."""
    try:
        return await GradingService().save_draft_attempt(test_id, user.id, request.answers, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tests/{test_id}/attempts/draft", response_model=DraftAttemptResponse)
async def get_draft_attempt(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DraftAttemptResponse:
    """Get the in-progress/draft attempt for a test, if one exists."""
    try:
        return await GradingService().get_draft_attempt(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/users/resumable-tests", response_model=list[ResumableTestInfo])
async def get_resumable_tests(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[ResumableTestInfo]:
    """Get list of tests with in-progress attempts that can be resumed."""
    return await GradingService().get_resumable_tests(user.id, session)


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


@router.get("/attempts/{attempt_id}", response_model=AttemptDetail)
async def get_attempt(
    attempt_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> AttemptDetail:
    try:
        return await GradingService().get_attempt_detail(attempt_id, user.id, session)
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


@router.post("/attempts/{attempt_id}/review-summary", response_model=ReviewSummaryResponse)
async def generate_review_summary(
    attempt_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ReviewSummaryResponse:
    try:
        detail = await GradingService().get_attempt_detail(attempt_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    missed = [a for a in detail.answers if not a.is_correct]
    if not missed:
        return ReviewSummaryResponse(summary="All answers were correct — nothing to review!")

    missed_dicts = [
        {
            "question_text": a.question_text,
            "user_answer": a.user_answer,
            "correct_answer": a.correct_answer,
            "feedback": a.feedback,
        }
        for a in missed
    ]

    try:
        summary = await LLMService().generate_review_summary(missed_dicts)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ReviewSummaryResponse(summary=summary)
