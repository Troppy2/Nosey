import asyncio
import hashlib
import json
import math
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.database import async_session_maker, get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.models.folder import Folder
from src.models.learning_module import LearningModule, LearningTrack
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.schemas.learning_module_schema import (
    CreateLearningTrackRequest,
    LearningModuleResponse,
    LearningTrackResponse,
    QuizAttemptRequest,
    QuizAttemptResponse,
    QuizQuestionPublic,
)
from src.services.file_service import FileService
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ResourceNotFoundException, StudyAppException
from src.utils.logger import get_logger

router = APIRouter(tags=["learning-modules"])
logger = get_logger(__name__)

# Questions per module quiz and the pass bar (80%, so 4/5).
QUIZ_QUESTION_COUNT = 5
PASS_RATIO = 0.8

# Strong references to detached generation tasks, mirroring routes/tests.py:
# generation is spawned with asyncio.create_task (NOT FastAPI BackgroundTasks)
# so the POST's HTTP connection is freed as soon as the 201 returns.
_track_tasks: set[asyncio.Task] = set()


def _spawn_track_generation(coro) -> None:
    task = asyncio.create_task(coro)
    _track_tasks.add(task)
    task.add_done_callback(_track_tasks.discard)


def _hash_notes(notes: str) -> str:
    return hashlib.sha256(notes.encode("utf-8")).hexdigest()


def _pass_threshold(total: int) -> int:
    return max(1, math.ceil(total * PASS_RATIO))


async def _mark_track_failed(track_id: int, message: str) -> None:
    async with async_session_maker() as session:
        track = await session.get(LearningTrack, track_id)
        if track is not None:
            track.status = "failed"
            track.error = message[:500]
            await session.commit()


async def _generate_track_background(
    track_id: int,
    user_id: int,
    folder_id: int,
    module_count: int,
    provider: Optional[str],
    custom_instructions: Optional[str] = None,
) -> None:
    """Build the whole track up front: outline, then lesson + quiz per module.

    Connection discipline (same as test generation): NO DB session is held open
    across LLM calls. Each result is written in a short-lived session and
    committed immediately, so the polling frontend sees modules land one by one.

    Cancellation: deleting the track (DELETE endpoint) is the cancel signal.
    Every persist step re-fetches by id inside a fresh session; when the row is
    gone the task returns quietly. Modules cascade-delete with the track.
    """
    _t0 = time.monotonic()
    llm = LLMService()
    try:
        # Read the folder's saved notes in a short-lived session.
        async with async_session_maker() as session:
            notes = await FileService().get_folder_files_content(folder_id, user_id, session)
        if not notes:
            await _mark_track_failed(
                track_id,
                "This folder has no saved notes. Upload notes to the folder first, then rebuild the track.",
            )
            return

        # Phase 1: outline (one LLM call), then persist all module shells so the
        # UI can show the track structure immediately.
        outline = await llm.generate_module_outline(
            notes, module_count, provider=provider, custom_instructions=custom_instructions
        )
        module_ids: list[int] = []
        async with async_session_maker() as session:
            track = await session.get(LearningTrack, track_id)
            if track is None:
                return  # cancelled
            track.notes_hash = _hash_notes(notes)
            modules = [
                LearningModule(
                    track_id=track_id,
                    order_index=index,
                    title=item["title"],
                    summary=item.get("summary") or None,
                )
                for index, item in enumerate(outline)
            ]
            session.add_all(modules)
            await session.commit()
            module_ids = [m.id for m in modules]

        # Phase 2: fill each module in order with ONE bundled LLM call returning
        # lesson + tts_script + quiz together (a single authoring task, so this
        # does not violate the one-task-per-call rule; it halves per-module
        # calls, which matters at 20 modules). Each write is its own short
        # session + commit so progress streams to the poller.
        for module_id, item in zip(module_ids, outline):
            content = await llm.generate_module_content(
                notes,
                item["title"],
                item.get("summary", ""),
                quiz_count=QUIZ_QUESTION_COUNT,
                provider=provider,
                custom_instructions=custom_instructions,
            )
            async with async_session_maker() as session:
                module = await session.get(LearningModule, module_id)
                if module is None:
                    return  # cancelled
                module.lesson_content = str(content["lesson"])
                module.tts_script = str(content.get("tts_script") or "") or None
                module.quiz_json = json.dumps(content["quiz"])
                await session.commit()

        # Phase 3: mark ready + usage event.
        duration_ms = int((time.monotonic() - _t0) * 1000)
        async with async_session_maker() as session:
            track = await session.get(LearningTrack, track_id)
            if track is None:
                return
            track.status = "ready"
            try:
                await UsageEventRepository(session).log_event(
                    user_id, "learning_track_generation", duration_ms, provider=provider
                )
            except Exception:
                pass
            await session.commit()
        logger.info("Learning track generation complete", extra={"track_id": track_id})
    except Exception as exc:
        logger.warning("Learning track generation failed for track_id=%s: %s", track_id, exc)
        duration_ms = int((time.monotonic() - _t0) * 1000)
        await _mark_track_failed(track_id, str(exc))
        async with async_session_maker() as err_session:
            try:
                await UsageEventRepository(err_session).log_event(
                    user_id,
                    "learning_track_generation",
                    duration_ms,
                    provider=provider,
                    success=False,
                    error_type=type(exc).__name__[:50],
                )
                await err_session.commit()
            except Exception:
                pass


def _module_to_response(module: LearningModule) -> LearningModuleResponse:
    quiz: Optional[list[QuizQuestionPublic]] = None
    if module.quiz_json:
        try:
            raw = json.loads(module.quiz_json)
            quiz = [
                QuizQuestionPublic(question=str(q["question"]), options=[str(o) for o in q["options"]])
                for q in raw
            ]
        except (ValueError, KeyError, TypeError):
            quiz = None
    return LearningModuleResponse(
        id=module.id,
        order_index=module.order_index,
        title=module.title,
        summary=module.summary,
        lesson_content=module.lesson_content,
        tts_script=module.tts_script,
        quiz=quiz,
        best_score=module.best_score,
        passed=module.passed,
        ready=bool(module.lesson_content and module.quiz_json),
    )


async def _get_owned_folder(folder_id: int, user_id: int, session: AsyncSession) -> Folder:
    folder = await session.scalar(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == user_id)
    )
    if folder is None:
        raise ResourceNotFoundException("Folder")
    return folder


@router.post(
    "/folders/{folder_id}/learning-track",
    response_model=LearningTrackResponse,
    status_code=status.HTTP_201_CREATED,
)
# Track builds are the most LLM-expensive endpoint in the app (1 outline +
# 1 bundled call per module, up to 21 calls per build), so creation is limited
# per-minute AND per-hour to stop rebuild spam from draining provider quota.
@limiter.limit("3/minute;10/hour")
async def create_learning_track(
    folder_id: int,
    request: Request,
    response: Response,
    data: CreateLearningTrackRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LearningTrackResponse:
    """Create (or rebuild) the folder's learning track and start generation."""
    try:
        await _get_owned_folder(folder_id, user.id, session)

        # Learning Modules are built from a folder's saved notes; flashcards are
        # not a valid source (planning decision Q6). Fail fast with a clear message.
        notes = await FileService().get_folder_files_content(folder_id, user.id, session)
        if not notes:
            raise StudyAppException(
                "Learning Modules are built from your folder's notes. Upload notes to this folder first."
            )

        provider = data.provider
        provider_aliases = {"google": "gemini", "anthropic": "claude"}
        if provider:
            provider = provider.strip().lower()
            provider = provider_aliases.get(provider, provider)
            if provider not in ("auto", "groq", "gemini", "claude", "ollama"):
                raise StudyAppException(
                    "provider must be auto, groq, google, anthropic, gemini, claude, or ollama"
                )

        custom_instructions = (data.custom_instructions or "").strip()[:10000] or None

        # Rebuild semantics: replace any existing track. Deleting the old row is
        # also the cancel signal for an in-flight generation (see background task).
        existing = await session.scalar(
            select(LearningTrack).where(LearningTrack.folder_id == folder_id)
        )
        if existing is not None:
            await session.delete(existing)
            await session.flush()

        track = LearningTrack(
            folder_id=folder_id,
            status="generating",
            module_count=data.module_count,
            provider=provider,
            custom_instructions=custom_instructions,
        )
        session.add(track)
        await session.commit()

        _spawn_track_generation(
            _generate_track_background(
                track_id=track.id,
                user_id=user.id,
                folder_id=folder_id,
                module_count=data.module_count,
                provider=provider,
                custom_instructions=custom_instructions,
            )
        )

        return LearningTrackResponse(
            id=track.id,
            folder_id=folder_id,
            status="generating",
            error=None,
            module_count=data.module_count,
            custom_instructions=custom_instructions,
            notes_stale=False,
            modules=[],
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/folders/{folder_id}/learning-track", response_model=LearningTrackResponse)
async def get_learning_track(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LearningTrackResponse:
    try:
        await _get_owned_folder(folder_id, user.id, session)
        track = await session.scalar(
            select(LearningTrack)
            .where(LearningTrack.folder_id == folder_id)
            .options(selectinload(LearningTrack.modules))
        )
        if track is None:
            raise ResourceNotFoundException("Learning track")

        # Staleness is only meaningful for a finished track, and hashing the
        # folder's full notes on every poll would be wasteful while generating.
        notes_stale = False
        if track.status == "ready" and track.notes_hash:
            current_notes = await FileService().get_folder_files_content(folder_id, user.id, session)
            notes_stale = bool(current_notes) and _hash_notes(current_notes) != track.notes_hash

        return LearningTrackResponse(
            id=track.id,
            folder_id=folder_id,
            status=track.status,
            error=track.error,
            module_count=track.module_count,
            custom_instructions=track.custom_instructions,
            notes_stale=notes_stale,
            modules=[_module_to_response(m) for m in track.modules],
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/folders/{folder_id}/learning-track", status_code=status.HTTP_204_NO_CONTENT)
async def delete_learning_track(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    """Delete the folder's track. Doubles as cancel while generation is running."""
    try:
        await _get_owned_folder(folder_id, user.id, session)
        track = await session.scalar(
            select(LearningTrack).where(LearningTrack.folder_id == folder_id)
        )
        if track is None:
            raise ResourceNotFoundException("Learning track")
        await session.delete(track)
        await session.commit()
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/learning-modules/{module_id}/quiz-attempt", response_model=QuizAttemptResponse)
async def submit_quiz_attempt(
    module_id: int,
    data: QuizAttemptRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> QuizAttemptResponse:
    """Grade a module quiz server-side (correct answers never reach the client)."""
    try:
        module = await session.scalar(
            select(LearningModule)
            .join(LearningTrack, LearningTrack.id == LearningModule.track_id)
            .join(Folder, Folder.id == LearningTrack.folder_id)
            .where(LearningModule.id == module_id, Folder.user_id == user.id)
        )
        if module is None:
            raise ResourceNotFoundException("Learning module")
        if not module.quiz_json:
            raise StudyAppException("This module's quiz is still being generated. Try again shortly.")

        try:
            quiz = json.loads(module.quiz_json)
        except ValueError as exc:
            raise StudyAppException("This module's quiz is corrupted. Rebuild the track.") from exc

        total = len(quiz)
        if len(data.answers) != total:
            raise StudyAppException(f"Expected {total} answers, got {len(data.answers)}.")

        correct_indices = [int(q["correct_index"]) for q in quiz]
        score = sum(1 for given, correct in zip(data.answers, correct_indices) if given == correct)
        passed = score >= _pass_threshold(total)

        if module.best_score is None or score > module.best_score:
            module.best_score = score
        if passed:
            module.passed = True
        await session.commit()

        return QuizAttemptResponse(
            score=score,
            total=total,
            passed=module.passed,
            correct_indices=correct_indices,
            best_score=module.best_score or score,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
