from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_beta_user, get_current_user
from src.models.user import User
from src.schemas.system_design_schema import (
    CLIENT_SUB_MODULES,
    SDProgressResponse,
    SDQuizGradeRequest,
    SDQuizGradeResponse,
    SDSubmissionResponse,
    SDSubmissionSaveRequest,
    SDSubModuleRequest,
)
from src.services.system_design_quiz_service import SystemDesignQuizService
from src.services.system_design_service import SystemDesignService
from src.utils.exceptions import LLMException, ResourceNotFoundException, StudyAppException
from src.utils.logger import get_logger

logger = get_logger(__name__)

# SECURITY: beta-only feature, enforced server-side (see dependencies.get_beta_user).
# It is excluded from usage limits, so basic users must not be able to reach it.
router = APIRouter(prefix="/system-design", tags=["system-design"], dependencies=[Depends(get_beta_user)])


def _http_error(exc: Exception, fallback: str) -> HTTPException:
    """Map service exceptions onto HTTP. Every handler funnels through this so an
    unhandled error still leaves as an HTTPException: raw 500s bypass
    CORSMiddleware and reach the browser without CORS headers or a detail field.
    """
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, ResourceNotFoundException):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, LLMException):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, StudyAppException):
        return HTTPException(status_code=400, detail=str(exc))
    logger.exception("Unhandled System Design error: %s", exc)
    return HTTPException(status_code=500, detail=fallback)


@router.get("/progress", response_model=SDProgressResponse)
async def get_sd_progress(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> SDProgressResponse:
    try:
        concepts = await SystemDesignService().get_progress(user.id, session)
    except Exception as exc:
        raise _http_error(exc, "Could not load your System Design progress.") from exc
    return SDProgressResponse(concepts=concepts)


@router.put(
    "/progress/{concept_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def mark_sd_sub_module(
    concept_id: str,
    body: SDSubModuleRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    # Only notes and video are the learner's word. visualizer and project are
    # earned by a passing run (the submission route) and quiz by a graded
    # attempt, so accepting them here would let a client self-award a concept.
    if body.sub_module not in CLIENT_SUB_MODULES:
        raise HTTPException(status_code=400, detail="That sub-module cannot be marked directly.")
    try:
        await SystemDesignService().mark_sub_module(
            user.id, concept_id, body.sub_module, body.done, session
        )
    except Exception as exc:
        raise _http_error(exc, "Could not save that progress change.") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/submissions/{exercise_id}", response_model=SDSubmissionResponse)
async def get_sd_submission(
    exercise_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> SDSubmissionResponse:
    try:
        return await SystemDesignService().get_submission(user.id, exercise_id, session)
    except Exception as exc:
        raise _http_error(exc, "Could not load that exercise workspace.") from exc


@router.put(
    "/submissions/{exercise_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def save_sd_submission(
    exercise_id: str,
    body: SDSubmissionSaveRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    try:
        await SystemDesignService().save_submission(
            user.id, exercise_id, body.files, body.ran_passed, session
        )
    except Exception as exc:
        raise _http_error(exc, "Could not save your work.") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/quiz/{concept_id}/grade", response_model=SDQuizGradeResponse)
async def grade_sd_quiz(
    concept_id: str,
    body: SDQuizGradeRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> SDQuizGradeResponse:
    try:
        return await SystemDesignQuizService().grade(user.id, concept_id, body, session)
    except Exception as exc:
        raise _http_error(exc, "Could not grade that quiz.") from exc
