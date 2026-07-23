from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.lc_sync import (
    LCActivityDate,
    LCBankProblem,
    LCCodeWorkspace,
    LCCustomProblem,
    LCDrillSchedule,
    LCPrepBank,
    LCProgress,
    LCProblemNote,
    LCStreakChallenge,
    LCStruggleEvent,
    LCTestRun,
)
from src.models.user import User
from src.schemas.leetcode_schema import (
    LCCustomProblemListResponse,
    LCCustomProblemResponse,
    LCBankAddProblemRequest,
    LCBankBulkAddRequest,
    LCCustomProblemSyncRequest,
    LCCustomTestCase,
    LCDailyProblemRequest,
    LCDrillAdvanceRequest,
    LCDrillCreateRequest,
    LCDrillScheduleResponse,
    LCGenerateCustomProblemRequest,
    LCGeneratedCustomProblem,
    LCPrepBankCreateRequest,
    LCPrepBankResponse,
    LCScoresResponse,
    LCStruggleEventRequest,
    LCTestRunRequest,
    LCNotesResponse,
    LCNotesSyncRequest,
    LCProgressResponse,
    LCProgressSyncRequest,
    LCStreakChallengeCreateRequest,
    LCStreakChallengeResponse,
    LCWorkspaceResponse,
    LCWorkspacesResponse,
    LCWorkspaceSyncRequest,
    LeetCodeGradeRequest,
    LeetCodeGradeResponse,
    LeetCodeHintRequest,
    LeetCodeHintResponse,
    LeetCodeProblemResponse,
)
from src.services.leetcode_service import LeetCodeService
from src.services.scoring_service import (
    EVENT_DRILL_ADVANCED_2,
    EVENT_DRILL_ADVANCED_3,
    EVENT_DRILL_COMPLETED,
    EVENT_FAILED_GRADE,
    EVENT_HINT_USED,
    EVENT_SELF_RATED_BRUTAL,
    EVENT_SELF_RATED_EASY,
    EVENT_SELF_RATED_HARD,
    EVENT_SELF_RATED_MEDIUM,
    EVENT_SOLUTION_VIEWED,
    EVENT_TIMER_EXPIRY,
    ScoringService,
)

# Struggle-event types the client is allowed to POST directly. hint_used and
# failed_grade are inserted server-side by the hint/grade routes, so they are not
# in this set; anything outside it is rejected to keep the scorer's data clean.
_CLIENT_STRUGGLE_EVENTS = frozenset(
    {
        EVENT_TIMER_EXPIRY,
        EVENT_SOLUTION_VIEWED,
        EVENT_SELF_RATED_EASY,
        EVENT_SELF_RATED_MEDIUM,
        EVENT_SELF_RATED_HARD,
        EVENT_SELF_RATED_BRUTAL,
    }
)
from src.utils.exceptions import LLMException, ResourceNotFoundException
from src.utils.provider_policy import resolve_request_provider

# Last-resort fallback only. The client normally picks the rescue problem (a random
# unsolved Medium/Hard from the verified + custom catalog) and sends it on create.
STREAK_CHALLENGE_FALLBACK_SLUG = "trapping-rain-water"

router = APIRouter(prefix="/leetcode", tags=["leetcode"])


@router.get("/problems/{title_slug}", response_model=LeetCodeProblemResponse)
async def get_problem(
    title_slug: str,
    user: User = Depends(get_current_user),
) -> LeetCodeProblemResponse:
    try:
        return await LeetCodeService().get_problem(title_slug)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Unable to load that LeetCode problem right now.") from exc


@router.post("/hint", response_model=LeetCodeHintResponse)
async def kojo_leetcode_hint(
    body: LeetCodeHintRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LeetCodeHintResponse:
    try:
        result = await LeetCodeService().hint(
            title_slug=body.title_slug,
            title=body.title,
            user_message=body.message,
            user_code=body.user_code,
            provider=resolve_request_provider(user, body.provider),
            statement=body.statement,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Every hint call is a struggle signal, logged after the LLM call succeeds so a
    # failed hint request doesn't pollute the weakness scorer.
    session.add(
        LCStruggleEvent(
            user_id=user.id,
            topic=body.topic,
            event_type=EVENT_HINT_USED,
            problem_slug=body.title_slug,
        )
    )
    await session.commit()
    return result


@router.post("/grade", response_model=LeetCodeGradeResponse)
async def grade_leetcode_submission(
    body: LeetCodeGradeRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LeetCodeGradeResponse:
    try:
        result = await LeetCodeService().grade(
            title_slug=body.title_slug,
            title=body.title,
            user_code=body.user_code,
            test_results=body.test_results,
            all_passed=body.all_passed,
            provider=resolve_request_provider(user, body.provider),
            statement=body.statement,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Only a failed grade is a struggle signal, not every grade call.
    if not body.all_passed:
        session.add(
            LCStruggleEvent(
                user_id=user.id,
                topic=body.topic,
                event_type=EVENT_FAILED_GRADE,
                problem_slug=body.title_slug,
            )
        )
        await _maybe_auto_add_drill(session, user.id, body.title_slug)
    await session.commit()
    return result


# ── Struggle events + weakness/improvement scorers ────────────────────────────
# Scoring logic itself lives in ScoringService (services/scoring_service.py); this
# section only owns event logging and the route wiring.


async def _maybe_auto_add_drill(
    session: AsyncSession, user_id: int, problem_slug: Optional[str]
) -> None:
    """A failed_grade or timer_expiry struggle signal auto-creates a drill row, unless
    one already exists for this (user, problem) -- lc_drill_schedule has a hard
    UniqueConstraint(user_id, problem_slug) (one row per problem per user, ever), so
    this checks for ANY existing row, not just an open one, to respect that."""
    if not problem_slug:
        return
    existing = (
        await session.execute(
            select(LCDrillSchedule).where(
                LCDrillSchedule.user_id == user_id,
                LCDrillSchedule.problem_slug == problem_slug,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return
    session.add(
        LCDrillSchedule(
            user_id=user_id,
            problem_slug=problem_slug,
            current_pass=1,
            next_due_at=datetime.now(timezone.utc),
            added_from="auto",
        )
    )


@router.post("/struggle-event", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def log_struggle_event(
    body: LCStruggleEventRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    if body.event_type not in _CLIENT_STRUGGLE_EVENTS:
        raise HTTPException(status_code=400, detail="Unknown struggle event type.")
    session.add(
        LCStruggleEvent(
            user_id=user.id,
            topic=body.topic,
            event_type=body.event_type,
            problem_slug=body.problem_slug,
        )
    )
    if body.event_type == EVENT_TIMER_EXPIRY:
        await _maybe_auto_add_drill(session, user.id, body.problem_slug)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/test-run", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def log_test_run(
    body: LCTestRunRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    """Logged each time the user runs their code (client-side pyodide run). Feeds the
    weakness grace period + success reduction and the improvement pass-rate trend."""
    session.add(
        LCTestRun(
            user_id=user.id,
            problem_slug=body.problem_slug,
            topic=body.topic,
            difficulty=body.difficulty,
            passed=body.passed,
        )
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/weakness", response_model=LCScoresResponse)
async def get_weakness(
    sensitivity: str = "medium",
    bank_id: Optional[int] = None,
    reset_at: Optional[datetime] = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCScoresResponse:
    # How aggressively weakness is flagged, set from the KojoCode cog. Unknown values
    # fall back to the neutral tuning rather than erroring.
    if sensitivity not in ("low", "medium", "high"):
        sensitivity = "medium"
    # Bank scope: restrict weakness to that bank's own problems (global vs bank are
    # treated separately). The bank must belong to the caller.
    slug_scope: Optional[set[str]] = None
    if bank_id is not None:
        await _get_owned_bank(session, user.id, bank_id)
        slug_scope = set(await _bank_problem_slugs(session, bank_id))
    return await ScoringService().get_scores(
        session, user.id, sensitivity=sensitivity, slug_scope=slug_scope, reset_at=reset_at
    )


# ── Progress & activity sync ──────────────────────────────────────────────────

@router.get("/progress", response_model=LCProgressResponse)
async def get_lc_progress(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCProgressResponse:
    progress_rows = (
        await session.execute(select(LCProgress).where(LCProgress.user_id == user.id))
    ).scalars().all()
    date_rows = (
        await session.execute(select(LCActivityDate).where(LCActivityDate.user_id == user.id))
    ).scalars().all()
    return LCProgressResponse(
        progress={row.problem_slug: row.done for row in progress_rows},
        activity_dates=[row.activity_date for row in date_rows],
        activity_counts={row.activity_date: row.count for row in date_rows},
    )


@router.put("/progress", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def sync_lc_progress(
    body: LCProgressSyncRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    existing_progress = {
        row.problem_slug: row
        for row in (
            await session.execute(select(LCProgress).where(LCProgress.user_id == user.id))
        ).scalars().all()
    }
    for slug, done in body.progress.items():
        if slug in existing_progress:
            existing_progress[slug].done = done
        else:
            session.add(LCProgress(user_id=user.id, problem_slug=slug, done=done))

    existing_dates = {
        row.activity_date: row
        for row in (
            await session.execute(select(LCActivityDate).where(LCActivityDate.user_id == user.id))
        ).scalars().all()
    }
    # Merge counts monotonically (max): the client sends the full per-day tally, and
    # taking the max means a stale device can never ratchet a day's count back down.
    # Dates without a supplied count default to 1 (one known solve).
    for date_str in body.activity_dates:
        incoming = max(1, body.activity_counts.get(date_str, 1))
        row = existing_dates.get(date_str)
        if row is None:
            session.add(LCActivityDate(user_id=user.id, activity_date=date_str, count=incoming))
        elif incoming > row.count:
            row.count = incoming

    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Code workspace sync ───────────────────────────────────────────────────────

@router.get("/workspace/{problem_slug}", response_model=LCWorkspaceResponse)
async def get_lc_workspace(
    problem_slug: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCWorkspaceResponse:
    row = (
        await session.execute(
            select(LCCodeWorkspace).where(
                LCCodeWorkspace.user_id == user.id,
                LCCodeWorkspace.problem_slug == problem_slug,
            )
        )
    ).scalar_one_or_none()
    if not row:
        return LCWorkspaceResponse(workspace=None)
    try:
        workspace = json.loads(row.workspace_json)
    except Exception:
        workspace = None
    return LCWorkspaceResponse(workspace=workspace)


@router.get("/workspaces", response_model=LCWorkspacesResponse)
async def get_lc_workspaces(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCWorkspacesResponse:
    rows = (
        await session.execute(select(LCCodeWorkspace).where(LCCodeWorkspace.user_id == user.id))
    ).scalars().all()
    workspaces: dict = {}
    for row in rows:
        try:
            workspaces[row.problem_slug] = json.loads(row.workspace_json)
        except Exception:
            pass
    return LCWorkspacesResponse(workspaces=workspaces)


@router.put("/workspace/{problem_slug}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def sync_lc_workspace(
    problem_slug: str,
    body: LCWorkspaceSyncRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    row = (
        await session.execute(
            select(LCCodeWorkspace).where(
                LCCodeWorkspace.user_id == user.id,
                LCCodeWorkspace.problem_slug == problem_slug,
            )
        )
    ).scalar_one_or_none()
    workspace_json = json.dumps(body.workspace)
    if row:
        row.workspace_json = workspace_json
    else:
        session.add(LCCodeWorkspace(user_id=user.id, problem_slug=problem_slug, workspace_json=workspace_json))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Problem notes sync ────────────────────────────────────────────────────────

@router.get("/notes/{problem_slug}", response_model=LCNotesResponse)
async def get_lc_notes(
    problem_slug: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCNotesResponse:
    row = (
        await session.execute(
            select(LCProblemNote).where(
                LCProblemNote.user_id == user.id,
                LCProblemNote.problem_slug == problem_slug,
            )
        )
    ).scalar_one_or_none()
    return LCNotesResponse(notes=row.notes if row else "")


@router.put("/notes/{problem_slug}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def sync_lc_notes(
    problem_slug: str,
    body: LCNotesSyncRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    row = (
        await session.execute(
            select(LCProblemNote).where(
                LCProblemNote.user_id == user.id,
                LCProblemNote.problem_slug == problem_slug,
            )
        )
    ).scalar_one_or_none()
    if row:
        row.notes = body.notes
    else:
        session.add(LCProblemNote(user_id=user.id, problem_slug=problem_slug, notes=body.notes))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Custom (user-authored) problems ───────────────────────────────────────────

def _serialize_custom_problem(row: LCCustomProblem) -> LCCustomProblemResponse:
    try:
        raw_cases = json.loads(row.test_cases_json or "[]")
    except Exception:
        raw_cases = []
    test_cases = [
        LCCustomTestCase(
            input_text=str(item.get("input_text", "") or ""),
            output_text=str(item.get("output_text", "") or ""),
            explanation_text=(str(item["explanation_text"]) if item.get("explanation_text") else None),
        )
        for item in raw_cases
        if isinstance(item, dict)
    ]
    return LCCustomProblemResponse(
        slug=row.slug,
        title=row.title,
        topic=row.topic,
        difficulty=row.difficulty,
        description=row.description,
        url=row.url,
        starter_code=row.starter_code,
        test_cases=test_cases,
        is_archived=row.is_archived,
    )


def _validate_custom_slug(slug: str) -> None:
    if not slug.startswith("custom-") or len(slug) > 200 or len(slug) < 8:
        raise HTTPException(status_code=400, detail="Invalid custom problem id.")


@router.get("/custom-problems", response_model=LCCustomProblemListResponse)
async def list_custom_problems(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCCustomProblemListResponse:
    rows = (
        await session.execute(
            select(LCCustomProblem)
            .where(LCCustomProblem.user_id == user.id)
            .order_by(LCCustomProblem.created_at.asc())
        )
    ).scalars().all()
    return LCCustomProblemListResponse(problems=[_serialize_custom_problem(row) for row in rows])


@router.put("/custom-problems/{slug}", response_model=LCCustomProblemResponse)
async def upsert_custom_problem(
    slug: str,
    body: LCCustomProblemSyncRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCCustomProblemResponse:
    _validate_custom_slug(slug)
    test_cases_json = json.dumps([case.model_dump() for case in body.test_cases])
    row = (
        await session.execute(
            select(LCCustomProblem).where(
                LCCustomProblem.user_id == user.id,
                LCCustomProblem.slug == slug,
            )
        )
    ).scalar_one_or_none()
    if row:
        row.title = body.title
        row.topic = body.topic or "unknown"
        row.difficulty = body.normalized_difficulty()
        row.description = body.description
        row.url = body.url
        row.starter_code = body.starter_code
        row.test_cases_json = test_cases_json
        row.is_archived = body.is_archived
    else:
        row = LCCustomProblem(
            user_id=user.id,
            slug=slug,
            title=body.title,
            topic=body.topic or "unknown",
            difficulty=body.normalized_difficulty(),
            description=body.description,
            url=body.url,
            starter_code=body.starter_code,
            test_cases_json=test_cases_json,
            is_archived=body.is_archived,
        )
        session.add(row)
    await session.commit()
    await session.refresh(row)
    return _serialize_custom_problem(row)


@router.delete("/custom-problems/{slug}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_custom_problem(
    slug: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    _validate_custom_slug(slug)
    row = (
        await session.execute(
            select(LCCustomProblem).where(
                LCCustomProblem.user_id == user.id,
                LCCustomProblem.slug == slug,
            )
        )
    ).scalar_one_or_none()
    if row:
        await session.delete(row)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/custom-problems/generate", response_model=LCGeneratedCustomProblem)
async def generate_custom_problem(
    body: LCGenerateCustomProblemRequest,
    user: User = Depends(get_current_user),
) -> LCGeneratedCustomProblem:
    if not body.code.strip() and not body.hint.strip():
        raise HTTPException(status_code=400, detail="Paste some code or describe the problem first.")
    try:
        return await LeetCodeService().generate_custom_problem(
            code=body.code,
            hint=body.hint,
            provider=resolve_request_provider(user, body.provider),
        )
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ── Daily KojoCode (beta-only) ────────────────────────────────────────────────

def _today_str() -> str:
    # Server-side calendar day (UTC) that the create-or-return lock keys on. GET and
    # POST use the same value, so a day's problem is consistent for both.
    return datetime.now(timezone.utc).date().isoformat()


async def _find_today_daily(session: AsyncSession, user_id: int) -> Optional[LCCustomProblem]:
    return (
        await session.execute(
            select(LCCustomProblem).where(
                LCCustomProblem.user_id == user_id,
                LCCustomProblem.source == "daily_kojo",
                LCCustomProblem.daily_date == _today_str(),
            )
        )
    ).scalar_one_or_none()


@router.get("/daily", response_model=Optional[LCCustomProblemResponse])
async def get_daily_problem(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Optional[LCCustomProblemResponse]:
    row = await _find_today_daily(session, user.id)
    if not row:
        return None
    return _serialize_custom_problem(row)


@router.post("/daily", response_model=LCCustomProblemResponse, status_code=status.HTTP_201_CREATED)
async def create_daily_problem(
    body: LCDailyProblemRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCCustomProblemResponse:
    # Locked for the day: one Daily KojoCode problem per calendar day. A second press
    # just re-opens today's, mirroring the LCStreakChallenge create-or-return pattern.
    existing = await _find_today_daily(session, user.id)
    if existing:
        return _serialize_custom_problem(existing)

    try:
        generated = await LeetCodeService().generate_daily_problem(
            topic=body.topic,
            target_difficulty=body.normalized_difficulty(),
            seed_slug=body.seed_slug,
            provider=resolve_request_provider(user, body.provider),
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    row = LCCustomProblem(
        user_id=user.id,
        # Reuses the custom-problem plumbing (progress/workspace/notes/run/grade all
        # key on slug), so it must start with "custom-" like every other custom slug.
        slug=f"custom-daily-{uuid.uuid4().hex}",
        title=generated.title or "Daily KojoCode Problem",
        # Topic and difficulty are authoritative from the client's request, not the LLM:
        # the backend takes target_difficulty as given (see the KojoCode plan) and the
        # client owns the topic taxonomy.
        topic=(body.topic or "unknown").strip()[:120] or "unknown",
        difficulty=body.normalized_difficulty(),
        description=generated.description,
        url="",
        starter_code=generated.starter_code,
        test_cases_json=json.dumps([case.model_dump() for case in generated.test_cases]),
        source="daily_kojo",
        daily_date=_today_str(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _serialize_custom_problem(row)


# ── Streak challenge (Save My Streak, beta-only) ──────────────────────────────

def _serialize_streak_challenge(row: LCStreakChallenge) -> LCStreakChallengeResponse:
    return LCStreakChallengeResponse(
        id=row.id,
        problem_slug=row.problem_slug,
        expires_at=row.expires_at.isoformat() if row.expires_at else None,
        completed_at=row.completed_at.isoformat() if row.completed_at else None,
        created_at=row.created_at.isoformat(),
    )


@router.get("/streak-challenge", response_model=Optional[LCStreakChallengeResponse])
async def get_streak_challenge(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Optional[LCStreakChallengeResponse]:
    row = (
        await session.execute(
            select(LCStreakChallenge)
            .where(LCStreakChallenge.user_id == user.id)
            .order_by(LCStreakChallenge.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not row:
        return None
    return _serialize_streak_challenge(row)


@router.post("/streak-challenge", response_model=LCStreakChallengeResponse, status_code=status.HTTP_201_CREATED)
async def create_streak_challenge(
    payload: Optional[LCStreakChallengeCreateRequest] = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCStreakChallengeResponse:
    # Only one active (uncompleted) challenge at a time. The problem stays fixed while
    # this challenge is active; a fresh random one is picked on the next streak loss.
    existing = (
        await session.execute(
            select(LCStreakChallenge)
            .where(
                LCStreakChallenge.user_id == user.id,
                LCStreakChallenge.completed_at.is_(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        return _serialize_streak_challenge(existing)
    requested_slug = (payload.problem_slug or "").strip() if payload else ""
    row = LCStreakChallenge(
        user_id=user.id,
        problem_slug=requested_slug or STREAK_CHALLENGE_FALLBACK_SLUG,
        expires_at=None,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _serialize_streak_challenge(row)


@router.post("/streak-challenge/complete", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def complete_streak_challenge(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    row = (
        await session.execute(
            select(LCStreakChallenge)
            .where(
                LCStreakChallenge.user_id == user.id,
                LCStreakChallenge.completed_at.is_(None),
            )
            .order_by(LCStreakChallenge.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="No active streak challenge found.")
    row.completed_at = datetime.now(timezone.utc)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Interview Prep Banks (beta-only) ──────────────────────────────────────────

async def _bank_problem_slugs(session: AsyncSession, bank_id: int) -> list[str]:
    rows = (
        await session.execute(
            select(LCBankProblem.problem_slug)
            .where(LCBankProblem.bank_id == bank_id)
            .order_by(LCBankProblem.added_at.asc())
        )
    ).scalars().all()
    return list(rows)


def _serialize_bank(row: LCPrepBank, problem_slugs: list[str]) -> LCPrepBankResponse:
    return LCPrepBankResponse(
        id=row.id,
        name=row.name,
        target=row.target,
        is_active=row.is_active,
        problem_slugs=problem_slugs,
        created_at=row.created_at.isoformat(),
    )


async def _get_owned_bank(session: AsyncSession, user_id: int, bank_id: int) -> LCPrepBank:
    row = (
        await session.execute(
            select(LCPrepBank).where(LCPrepBank.id == bank_id, LCPrepBank.user_id == user_id)
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Prep bank not found.")
    return row


@router.get("/banks", response_model=list[LCPrepBankResponse])
async def list_prep_banks(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[LCPrepBankResponse]:
    rows = (
        await session.execute(
            select(LCPrepBank).where(LCPrepBank.user_id == user.id).order_by(LCPrepBank.created_at.asc())
        )
    ).scalars().all()
    return [_serialize_bank(row, await _bank_problem_slugs(session, row.id)) for row in rows]


@router.post("/banks", response_model=LCPrepBankResponse, status_code=status.HTTP_201_CREATED)
async def create_prep_bank(
    body: LCPrepBankCreateRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCPrepBankResponse:
    row = LCPrepBank(user_id=user.id, name=body.name, target=body.target, is_active=False)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _serialize_bank(row, [])


@router.delete("/banks/{bank_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_prep_bank(
    bank_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    row = await _get_owned_bank(session, user.id, bank_id)
    await session.delete(row)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/banks/{bank_id}/activate", response_model=LCPrepBankResponse)
async def activate_prep_bank(
    bank_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCPrepBankResponse:
    row = await _get_owned_bank(session, user.id, bank_id)
    # Only one active bank per user, enforced here (query-then-deactivate) rather than
    # a DB constraint, mirroring how the one active streak challenge is enforced.
    others = (
        await session.execute(
            select(LCPrepBank).where(
                LCPrepBank.user_id == user.id,
                LCPrepBank.id != bank_id,
                LCPrepBank.is_active.is_(True),
            )
        )
    ).scalars().all()
    for other in others:
        other.is_active = False
    row.is_active = True
    await session.commit()
    await session.refresh(row)
    return _serialize_bank(row, await _bank_problem_slugs(session, row.id))


@router.post("/banks/{bank_id}/problems", response_model=LCPrepBankResponse, status_code=status.HTTP_201_CREATED)
async def add_bank_problem(
    bank_id: int,
    body: LCBankAddProblemRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCPrepBankResponse:
    row = await _get_owned_bank(session, user.id, bank_id)
    slug = body.problem_slug.strip()
    existing = (
        await session.execute(
            select(LCBankProblem).where(
                LCBankProblem.bank_id == bank_id,
                LCBankProblem.problem_slug == slug,
            )
        )
    ).scalar_one_or_none()
    if not existing and slug:
        session.add(LCBankProblem(bank_id=bank_id, problem_slug=slug))
        await session.commit()
    return _serialize_bank(row, await _bank_problem_slugs(session, bank_id))


@router.post(
    "/banks/{bank_id}/problems/bulk", response_model=LCPrepBankResponse, status_code=status.HTTP_201_CREATED
)
async def bulk_add_bank_problems(
    bank_id: int,
    body: LCBankBulkAddRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCPrepBankResponse:
    # Catalog-match import inverts direction: the frontend owns the catalog and
    # resolves free-pasted text to slugs itself, then batch-adds here. The backend
    # has no catalog to fuzzy-match against (see KOJOCODE_BACKEND_IMPLEMENTATION.md).
    row = await _get_owned_bank(session, user.id, bank_id)
    existing_slugs = set(await _bank_problem_slugs(session, bank_id))
    for raw_slug in body.slugs:
        slug = (raw_slug or "").strip()
        if slug and slug not in existing_slugs:
            session.add(LCBankProblem(bank_id=bank_id, problem_slug=slug))
            existing_slugs.add(slug)
    await session.commit()
    return _serialize_bank(row, await _bank_problem_slugs(session, bank_id))


@router.delete(
    "/banks/{bank_id}/problems/{slug}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
async def remove_bank_problem(
    bank_id: int,
    slug: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    await _get_owned_bank(session, user.id, bank_id)
    existing = (
        await session.execute(
            select(LCBankProblem).where(
                LCBankProblem.bank_id == bank_id,
                LCBankProblem.problem_slug == slug,
            )
        )
    ).scalar_one_or_none()
    if existing:
        await session.delete(existing)
        await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 3-Pass Drill schedule (beta-only) ─────────────────────────────────────────

# Expanding intervals: pass 1 -> 2 waits at least 24h, pass 2 -> 3 waits a few days
# longer (72h), per the 3-Pass Spaced Repetition spec (todo-kojocode-rebuild.md 3h).
_DRILL_PASS_INTERVALS = {1: timedelta(hours=24), 2: timedelta(hours=72)}
_DRILL_ADVANCE_EVENT_TYPES = {2: EVENT_DRILL_ADVANCED_2, 3: EVENT_DRILL_ADVANCED_3}


def _serialize_drill(row: LCDrillSchedule) -> LCDrillScheduleResponse:
    return LCDrillScheduleResponse(
        id=row.id,
        problem_slug=row.problem_slug,
        current_pass=row.current_pass,
        next_due_at=row.next_due_at.isoformat(),
        added_from=row.added_from,
        completed_at=row.completed_at.isoformat() if row.completed_at else None,
    )


@router.get("/drills", response_model=list[LCDrillScheduleResponse])
async def list_drills(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[LCDrillScheduleResponse]:
    rows = (
        await session.execute(
            select(LCDrillSchedule)
            .where(LCDrillSchedule.user_id == user.id, LCDrillSchedule.completed_at.is_(None))
            .order_by(LCDrillSchedule.next_due_at.asc())
        )
    ).scalars().all()
    return [_serialize_drill(row) for row in rows]


@router.post("/drills", response_model=LCDrillScheduleResponse, status_code=status.HTTP_201_CREATED)
async def create_drill(
    body: LCDrillCreateRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCDrillScheduleResponse:
    # Create-or-return: lc_drill_schedule has UniqueConstraint(user_id, problem_slug),
    # one row per problem per user ever, so a repeat manual add just returns it.
    existing = (
        await session.execute(
            select(LCDrillSchedule).where(
                LCDrillSchedule.user_id == user.id,
                LCDrillSchedule.problem_slug == body.problem_slug,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return _serialize_drill(existing)
    row = LCDrillSchedule(
        user_id=user.id,
        problem_slug=body.problem_slug,
        current_pass=1,
        next_due_at=datetime.now(timezone.utc),
        added_from="manual",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _serialize_drill(row)


@router.post("/drills/{slug}/advance", response_model=LCDrillScheduleResponse)
async def advance_drill(
    slug: str,
    body: Optional[LCDrillAdvanceRequest] = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LCDrillScheduleResponse:
    row = (
        await session.execute(
            select(LCDrillSchedule).where(
                LCDrillSchedule.user_id == user.id,
                LCDrillSchedule.problem_slug == slug,
                LCDrillSchedule.completed_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="No open drill found for that problem.")

    if row.current_pass >= 3:
        row.completed_at = datetime.now(timezone.utc)
        event_type = EVENT_DRILL_COMPLETED
    else:
        row.next_due_at = datetime.now(timezone.utc) + _DRILL_PASS_INTERVALS[row.current_pass]
        row.current_pass += 1
        event_type = _DRILL_ADVANCE_EVENT_TYPES[row.current_pass]

    # Logged so the improvement scorer can see pass advancement and the weakness
    # scorer can reset the topic on pass-3 completion (lc_drill_schedule itself has
    # no topic column, so this is skipped when the caller doesn't send one).
    if body and body.topic:
        session.add(
            LCStruggleEvent(
                user_id=user.id,
                topic=body.topic,
                event_type=event_type,
                problem_slug=slug,
            )
        )

    await session.commit()
    await session.refresh(row)
    return _serialize_drill(row)
