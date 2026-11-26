"""Pattern Trails routes (spec: .claude/plans/specs/spec-pattern-trails.md, section 5).

SECURITY: beta-only, enforced server-side at the router (rule 6j). The one LLM
call (Kojo's note on a gate pick's reason) goes through the Kojo gate (rule 6i).

No `from __future__ import annotations` in this module: slowapi's limiter
wrapper hides the module globals, so FastAPI could not resolve a string-annotated
JSON body on the rate-limited pick route and would answer 422 (rules-gotchas).
"""
from typing import Awaitable, Optional, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_beta_user
from src.limiter import limiter
from src.models.user import User
from src.routes.kojo import _kojo_gate
from src.schemas.pattern_trails_schema import (
    PTGateAttemptOut,
    PTGateProblemOut,
    PTGateSolveRequest,
    PTGateSolveResponse,
    PTMapResponse,
    PTPathResponse,
    PTPickRequest,
    PTPickResponse,
    PTRedoListResponse,
    PTRedoResultRequest,
    PTRedoResultResponse,
    PTStepResultRequest,
    PTStepResultResponse,
)
from src.services.account_safety_service import screen_user_input
from src.services.leetcode_service import LeetCodeService
from src.services.pattern_trails.reason_note import build_reason_prompt, write_reason_note
from src.services.pattern_trails.service import PatternTrailService, TrailConflict
from src.utils.exceptions import ResourceNotFoundException, StudyAppException
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/pattern-trails", tags=["pattern-trails"], dependencies=[Depends(get_beta_user)])

NOTE_FEATURE = "kojo_trail_reason"

T = TypeVar("T")


async def _run(work: Awaitable[T]) -> T:
    """Exception mapping per CLAUDE.md. Unexpected errors become an HTTPException
    so the CORS headers survive (rules-gotchas: CORS headers missing on 500s)."""
    try:
        return await work
    except HTTPException:
        raise
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TrailConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Pattern Trails request failed")
        raise HTTPException(status_code=500, detail="Something went wrong on the trail. Try again.") from exc


# ── Map and paths ─────────────────────────────────────────────────────────────


@router.get("", response_model=PTMapResponse)
async def get_map(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTMapResponse:
    return await _run(PatternTrailService().get_map(session, user.id))


@router.get("/subtopics/{slug}", response_model=PTPathResponse)
async def get_path(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTPathResponse:
    return await _run(PatternTrailService().get_path(session, user.id, slug))


@router.post("/subtopics/{slug}/lesson-watched", response_model=PTPathResponse)
async def lesson_watched(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTPathResponse:
    return await _run(PatternTrailService().mark_lesson_watched(session, user.id, slug))


@router.post("/steps/{step_id}/result", response_model=PTStepResultResponse)
async def step_result(
    step_id: int,
    body: PTStepResultRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTStepResultResponse:
    return await _run(
        PatternTrailService().record_step_result(
            session,
            user.id,
            step_id,
            pass_number=body.pass_number,
            accepted=body.accepted,
            seconds=body.seconds,
            tz_offset_minutes=body.tz_offset_minutes,
        )
    )


# ── Redos ─────────────────────────────────────────────────────────────────────


@router.get("/redos", response_model=PTRedoListResponse)
async def list_redos(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTRedoListResponse:
    return await _run(PatternTrailService().list_redos(session, user.id))


@router.post("/redos/{redo_id}/result", response_model=PTRedoResultResponse)
async def redo_result(
    redo_id: int,
    body: PTRedoResultRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTRedoResultResponse:
    return await _run(
        PatternTrailService().record_redo_result(
            session, user.id, redo_id, accepted=body.accepted, seconds=body.seconds
        )
    )


# ── Topic gate ────────────────────────────────────────────────────────────────


@router.post("/gates/{topic_slug}/start", response_model=PTGateAttemptOut)
async def start_gate(
    topic_slug: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTGateAttemptOut:
    return await _run(PatternTrailService().start_gate(session, user.id, topic_slug))


@router.get("/gates/attempts/{attempt_id}", response_model=PTGateAttemptOut)
async def get_attempt(
    attempt_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTGateAttemptOut:
    return await _run(PatternTrailService().get_attempt(session, user.id, attempt_id))


@router.get("/gates/attempts/{attempt_id}/items/{item_id}/problem", response_model=PTGateProblemOut)
async def gate_problem(
    attempt_id: int,
    item_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTGateProblemOut:
    """The statement for one gate item. The problem slug, title and topic tags never
    leave the server, so the problem cannot give its pattern away."""
    item = await _run(PatternTrailService().gate_item(session, user.id, attempt_id, item_id))
    try:
        problem = await LeetCodeService().get_problem(item.problem_slug)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail="Gate problem not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Unable to load this problem right now.") from exc
    return PTGateProblemOut(
        item_id=item.id,
        difficulty=item.difficulty,
        statement_text=item.statement_override,
        content_html=problem.content_html,
        examples=problem.examples,
        example_testcases=problem.example_testcases,
        python_snippet=problem.python_snippet,
    )


async def _kojo_note(session: AsyncSession, user: User, prompt: str) -> Optional[str]:
    """Kojo's note, or None. Never fails the pick: a Kojo limit (429), a missing
    device id or any provider failure just means no note."""
    try:
        slot = await _kojo_gate(session, user, NOTE_FEATURE)
    except HTTPException as exc:
        logger.info("Pattern Trails note skipped by the Kojo gate: %s", exc.detail)
        return None
    try:
        # End the gate's read transaction before the LLM call (Neon drops idle
        # in-transaction connections; rules-gotchas, GH #169).
        await session.commit()
        return await write_reason_note(prompt)
    finally:
        slot.release()


@router.post("/gates/attempts/{attempt_id}/pick", response_model=PTPickResponse)
@limiter.limit("20/minute")
async def pick(
    request: Request,
    response: Response,
    attempt_id: int,
    body: PTPickRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTPickResponse:
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Write a few words on why.")
    # GH #173: typed text is screened before it reaches any AI model.
    await screen_user_input(user, NOTE_FEATURE, reason)

    service = PatternTrailService()
    attempt, item, picked, right, correct = await _run(
        service.record_pick(
            session, user.id, attempt_id, item_id=body.item_id, picked_key=body.picked_key, reason=reason
        )
    )

    note: Optional[str] = None
    if user.age is None or user.age >= 15:  # same age floor as Kojo chat
        note = await _kojo_note(
            session,
            user,
            build_reason_prompt(
                picked_title=picked.title, right_title=right.title, correct=correct, reason=reason, cue=item.cue
            ),
        )
    if note:
        try:
            await service.save_note(session, attempt_id, item.id, note)
        except Exception:
            # The note is still returned; only its stored copy is lost.
            logger.exception("Pattern Trails note could not be saved")
        for out in attempt.items:
            if out.id == item.id:
                out.kojo_note = note

    return PTPickResponse(
        item_id=item.id,
        correct=correct,
        right_pattern=right,
        cue=item.cue,
        kojo_note=note,
        attempt=attempt,
    )


@router.post("/gates/attempts/{attempt_id}/solve", response_model=PTGateSolveResponse)
async def gate_solve(
    attempt_id: int,
    body: PTGateSolveRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> PTGateSolveResponse:
    return await _run(
        PatternTrailService().record_gate_solve(
            session, user.id, attempt_id, item_id=body.item_id, accepted=body.accepted, seconds=body.seconds
        )
    )

