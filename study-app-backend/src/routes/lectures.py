"""Kojo pattern lectures for KojoCode (see services/lecture_service.py).

Lectures are shared by every user and written by an admin's MCP connector, so these
routes never call Nosey's LLM. Users can read the catalog, play a lecture, record its
narration (shared per voice) and request a topic that does not exist yet.
"""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_beta_user
from src.models.lc_sync import LCLecture, LCLectureAudio, LCLectureRequest
from src.models.user import User
from src.schemas.leetcode_schema import LCWalkthroughAudioRequest, LCWalkthroughAudioResponse
from src.services import lc_catalog
from src.services.account_safety_service import screen_user_input
from src.services.lecture_service import CATALOG, SLUG_RE, normalize_topic, relayout_lecture, spoken_lines
from src.services.speech_service import record_lines
from src.utils.exceptions import LLMException, ValidationException

router = APIRouter(prefix="/leetcode/lectures", tags=["lectures"], dependencies=[Depends(get_beta_user)])

REQUESTS_PER_DAY = 2
_AUDIO_CONCURRENCY = 4


class LectureSummary(BaseModel):
    slug: str
    title: str
    category: str
    summary: str
    problem_slug: str
    problem_title: str
    source: str  # curated | community
    ready: bool


class LectureRequestOut(BaseModel):
    id: int
    topic: str
    status: str
    lecture_slug: Optional[str]


class LectureListResponse(BaseModel):
    lectures: list[LectureSummary]
    requests: list[LectureRequestOut]
    requests_left_today: int


class LectureResponse(BaseModel):
    slug: str
    title: str
    category: str
    summary: str
    problem_slug: str
    problem_title: str
    source: str
    lecture: dict


class LectureRequestIn(BaseModel):
    topic: str = Field(..., min_length=2, max_length=120)
    category: Optional[str] = Field(default=None, max_length=60)


def _problem_title(slug: str) -> str:
    p = lc_catalog.get(slug)
    return p.title if p else slug.replace("-", " ").title()


async def _requests_today(session: AsyncSession, user: User) -> int:
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    return (await session.execute(
        select(func.count(LCLectureRequest.id)).where(
            LCLectureRequest.user_id == user.id, LCLectureRequest.created_at >= since
        )
    )).scalar_one()


@router.get("", response_model=LectureListResponse)
async def list_lectures(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> LectureListResponse:
    rows = {r.slug: r for r in (await session.execute(select(LCLecture))).scalars().all()}
    out: list[LectureSummary] = []
    for c in CATALOG:
        row = rows.pop(c.slug, None)
        out.append(LectureSummary(
            slug=c.slug, title=row.title if row else c.title, category=c.category,
            summary=row.summary if row else "", problem_slug=c.problem_slug,
            problem_title=_problem_title(c.problem_slug), source="curated", ready=row is not None,
        ))
    for row in sorted(rows.values(), key=lambda r: r.title.lower()):  # community lectures
        out.append(LectureSummary(
            slug=row.slug, title=row.title, category=row.category, summary=row.summary,
            problem_slug=row.problem_slug, problem_title=_problem_title(row.problem_slug),
            source=row.source, ready=True,
        ))
    mine = (await session.execute(
        select(LCLectureRequest).where(LCLectureRequest.user_id == user.id)
        .order_by(LCLectureRequest.created_at.desc()).limit(20)
    )).scalars().all()
    left = max(0, REQUESTS_PER_DAY - await _requests_today(session, user))
    return LectureListResponse(
        lectures=out,
        requests=[LectureRequestOut(id=r.id, topic=r.topic, status=r.status, lecture_slug=r.lecture_slug) for r in mine],
        requests_left_today=left,
    )


@router.get("/{slug}", response_model=LectureResponse)
async def get_lecture(slug: str, session: AsyncSession = Depends(get_session)) -> LectureResponse:
    if not SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid lecture id.")
    row = (await session.execute(select(LCLecture).where(LCLecture.slug == slug))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Kojo hasn't recorded this lecture yet.")
    return LectureResponse(
        slug=row.slug, title=row.title, category=row.category, summary=row.summary,
        problem_slug=row.problem_slug, problem_title=_problem_title(row.problem_slug),
        source=row.source, lecture=relayout_lecture(json.loads(row.lecture_json)),
    )


@router.post("/requests", response_model=LectureRequestOut)
async def request_lecture(
    body: LectureRequestIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> LectureRequestOut:
    """Ask for a topic Kojo doesn't teach yet. Moderated, deduped, 2 a day. An admin's
    connector fulfills the queue (MCP list_lecture_requests + create_lecture)."""
    topic = " ".join(body.topic.split())
    await screen_user_input(user, "leetcode_lecture_request", topic)
    key = normalize_topic(topic)
    if not key:
        raise HTTPException(status_code=400, detail="Name a DSA topic, like 'segment tree' or 'KMP'.")
    existing = (await session.execute(select(LCLecture.slug, LCLecture.title))).all()
    for slug, title in existing:
        if normalize_topic(title) == key:
            raise HTTPException(status_code=409, detail=f"Kojo already has a lecture on that: {title}.")
    same = (await session.execute(
        select(LCLectureRequest).where(LCLectureRequest.normalized == key, LCLectureRequest.status == "pending")
    )).scalars().first()
    if same is not None:
        return LectureRequestOut(id=same.id, topic=same.topic, status=same.status, lecture_slug=None)
    if await _requests_today(session, user) >= REQUESTS_PER_DAY:
        raise HTTPException(status_code=429, detail=f"You can request {REQUESTS_PER_DAY} topics a day. Try again tomorrow.")
    row = LCLectureRequest(user_id=user.id, topic=topic, normalized=key, category=body.category, status="pending")
    session.add(row)
    await session.commit()
    return LectureRequestOut(id=row.id, topic=row.topic, status=row.status, lecture_slug=None)


@router.post("/{slug}/audio", response_model=LCWalkthroughAudioResponse)
async def record_lecture_audio(
    slug: str,
    body: LCWalkthroughAudioRequest,
    session: AsyncSession = Depends(get_session),
) -> LCWalkthroughAudioResponse:
    """Record a lecture's narration in one voice and share it with every user. Only
    lines of a lecture that exists can be recorded, so this can't be used as free TTS."""
    if not SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid lecture id.")
    row = (await session.execute(select(LCLecture).where(LCLecture.slug == slug))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Kojo hasn't recorded this lecture yet.")
    # Only the lecture's full, exact set of spoken lines can be recorded: a subset or
    # foreign text is refused, so nobody can thrash the shared recording or use this
    # as free TTS. The cache key is the sorted canonical set, so line order never
    # forces a re-record, and clips are stored per line.
    canonical = sorted(spoken_lines(json.loads(row.lecture_json)))
    requested = [line.strip() for line in body.lines]
    if len(requested) != len(set(requested)) or sorted(requested) != canonical:
        raise HTTPException(status_code=400, detail="Those lines don't match this lecture. Reload and try again.")
    lines_hash = hashlib.sha256("\n".join(canonical).encode("utf-8")).hexdigest()
    cached = (await session.execute(select(LCLectureAudio).where(
        LCLectureAudio.lecture_slug == slug, LCLectureAudio.voice == body.voice, LCLectureAudio.lines_hash == lines_hash,
    ))).scalar_one_or_none()
    if cached is not None:
        by_line = json.loads(cached.clips_json)
        if isinstance(by_line, dict) and all(line in by_line for line in requested):
            return LCWalkthroughAudioResponse(voice=body.voice, clips=[by_line[line] for line in requested])

    try:
        clips = await record_lines(canonical, body.voice, _AUDIO_CONCURRENCY)
    except (LLMException, ValidationException) as exc:
        raise HTTPException(status_code=503, detail="Kojo couldn't record the audio right now. Try again, or use the browser voice.") from exc
    by_line = dict(zip(canonical, clips))

    # Replace an older recording of this voice (the lecture was edited since).
    for old in (await session.execute(select(LCLectureAudio).where(
        LCLectureAudio.lecture_slug == slug, LCLectureAudio.voice == body.voice,
    ))).scalars().all():
        await session.delete(old)
    session.add(LCLectureAudio(lecture_slug=slug, voice=body.voice, lines_hash=lines_hash, clips_json=json.dumps(by_line)))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
    return LCWalkthroughAudioResponse(voice=body.voice, clips=[by_line[line] for line in requested])
