from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.lc_sync import LCActivityDate, LCCodeWorkspace, LCProgress
from src.models.user import User
from src.schemas.leetcode_schema import (
    LCProgressResponse,
    LCProgressSyncRequest,
    LCWorkspaceResponse,
    LCWorkspaceSyncRequest,
    LeetCodeGradeRequest,
    LeetCodeGradeResponse,
    LeetCodeHintRequest,
    LeetCodeHintResponse,
    LeetCodeProblemResponse,
)
from src.services.leetcode_service import LeetCodeService
from src.utils.exceptions import LLMException, ResourceNotFoundException

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
    user: User = Depends(get_current_user),
) -> LeetCodeHintResponse:
    try:
        return await LeetCodeService().hint(
            title_slug=body.title_slug,
            title=body.title,
            user_message=body.message,
            user_code=body.user_code,
            provider=body.provider,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/grade", response_model=LeetCodeGradeResponse)
async def grade_leetcode_submission(
    body: LeetCodeGradeRequest,
    user: User = Depends(get_current_user),
) -> LeetCodeGradeResponse:
    try:
        return await LeetCodeService().grade(
            title_slug=body.title_slug,
            title=body.title,
            user_code=body.user_code,
            test_results=body.test_results,
            all_passed=body.all_passed,
            provider=body.provider,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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
        row.activity_date
        for row in (
            await session.execute(select(LCActivityDate).where(LCActivityDate.user_id == user.id))
        ).scalars().all()
    }
    for date_str in body.activity_dates:
        if date_str not in existing_dates:
            session.add(LCActivityDate(user_id=user.id, activity_date=date_str))

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
