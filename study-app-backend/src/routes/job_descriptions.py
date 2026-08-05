from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.job_description import UserJobDescription
from src.models.user import User
from src.schemas.job_description_schema import (
    JobDescriptionCreateRequest,
    JobDescriptionResponse,
    JobDescriptionUpdateRequest,
    SavedJDParsed,
)

# Its own prefix rather than a path under /mock-interview: that router already owns
# GET /mock-interview/{session_id}, whose int converter would reject a nested literal
# path segment with a 422 before it could match.
router = APIRouter(prefix="/job-descriptions", tags=["job-descriptions"])

# Saved JDs are a convenience list, not a document store. The cap keeps one account
# from turning the picker (and the table) into a dumping ground.
MAX_SAVED_JDS = 25


def _parsed(row: UserJobDescription) -> Optional[SavedJDParsed]:
    if not row.parsed_json:
        return None
    try:
        return SavedJDParsed(**json.loads(row.parsed_json))
    except Exception:
        # A malformed blob should not hide the JD itself; the panel falls back to
        # re-analyzing the text.
        return None


def _to_response(row: UserJobDescription) -> JobDescriptionResponse:
    return JobDescriptionResponse(
        id=row.id,
        name=row.name,
        company_name=row.company_name,
        jd_text=row.jd_text,
        parsed=_parsed(row),
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


async def _load_jd(jd_id: int, user: User, db: AsyncSession) -> UserJobDescription:
    row = (
        await db.execute(
            select(UserJobDescription).where(
                UserJobDescription.id == jd_id,
                UserJobDescription.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Saved job description not found.")
    return row


@router.get("", response_model=list[JobDescriptionResponse])
async def list_job_descriptions(
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[JobDescriptionResponse]:
    rows = (
        await db.execute(
            select(UserJobDescription)
            .where(UserJobDescription.user_id == user.id)
            .order_by(UserJobDescription.updated_at.desc())
        )
    ).scalars().all()
    return [_to_response(row) for row in rows]


@router.post("", response_model=JobDescriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_job_description(
    body: JobDescriptionCreateRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    count = (
        await db.execute(
            select(func.count())
            .select_from(UserJobDescription)
            .where(UserJobDescription.user_id == user.id)
        )
    ).scalar_one()
    if count >= MAX_SAVED_JDS:
        raise HTTPException(
            status_code=400,
            detail=f"You can save up to {MAX_SAVED_JDS} job descriptions. Delete one first.",
        )

    row = UserJobDescription(
        user_id=user.id,
        name=body.name.strip(),
        company_name=(body.company_name or "").strip() or None,
        jd_text=body.jd_text,
        parsed_json=body.parsed.model_dump_json() if body.parsed else None,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="You already have a saved job description with that name."
        ) from exc
    await db.refresh(row)
    return _to_response(row)


@router.put("/{jd_id}", response_model=JobDescriptionResponse)
async def update_job_description(
    jd_id: int,
    body: JobDescriptionUpdateRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    row = await _load_jd(jd_id, user, db)
    if body.name is not None:
        row.name = body.name.strip()
    if body.company_name is not None:
        row.company_name = body.company_name.strip() or None
    if body.jd_text is not None:
        row.jd_text = body.jd_text
    if body.parsed is not None:
        row.parsed_json = body.parsed.model_dump_json()
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="You already have a saved job description with that name."
        ) from exc
    await db.refresh(row)
    return _to_response(row)


@router.delete("/{jd_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job_description(
    jd_id: int,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    row = await _load_jd(jd_id, user, db)
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
