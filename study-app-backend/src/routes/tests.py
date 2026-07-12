import asyncio
import hashlib
import time
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from src.database import async_session_maker, get_session
from src.limiter import limiter
from src.dependencies import get_current_user
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.test import Test
from src.models.user import User
from src.repositories.test_repository import TestRepository
from src.repositories.usage_event_repository import UsageEventRepository
from src.schemas.test_schema import (
    CreateTestResponse,
    QuestionCreate,
    RegenerateTestRequest,
    QuestionEditable,
    QuestionUpdate,
    TestResponse,
    TestSummary,
    TestTakeResponse,
    TestUpdate,
    WeaknessResponse,
)
from src.services.file_service import FileService
from src.services.grading_service import GradingService
from src.services.kojo_context_cache import invalidate_folder
from src.services.llm_service import LLMService
from src.services.test_service import TestService
from src.utils.exceptions import LLMException, ResourceNotFoundException, StudyAppException
from src.utils.logger import get_logger
from src.utils.validators import MAX_UPLOAD_TOTAL_SIZE_BYTES

router = APIRouter(tags=["tests"])
logger = get_logger(__name__)


# Strong references to detached generation tasks. We deliberately do NOT use
# FastAPI BackgroundTasks for generation: those run *inside* the ASGI response
# cycle, so with a single uvicorn worker and HTTP/1.1 keep-alive the POST's TCP
# connection stays busy for the whole ~30-60s generation. The browser then reuses
# that same keep-alive connection for one of the post-create GETs (e.g.
# GET /folders/{id}/tests), which hangs until generation finishes. Spawning the
# work with asyncio.create_task frees the connection as soon as the 201 returns.
# A reference is kept here so the task is not garbage-collected mid-run.
_generation_tasks: set[asyncio.Task] = set()


def _spawn_generation(coro) -> None:
    """Detach a generation coroutine from the request/response cycle."""
    task = asyncio.create_task(coro)
    _generation_tasks.add(task)
    task.add_done_callback(_generation_tasks.discard)


class _BytesUploadFile:
    """Minimal UploadFile stand-in backed by in-memory bytes."""

    def __init__(self, data: bytes, filename: str) -> None:
        self._data = data
        self.filename = filename

    async def read(self) -> bytes:
        return self._data

    async def seek(self, pos: int) -> None:
        pass  # no-op; bytes are always fully available


async def _persist_generated(
    repo: TestRepository,
    test_id: int,
    mcq_questions: list,
    frq_questions: list,
    start_order: int,
) -> int:
    """Write a batch of generated MCQ/FRQ questions; return the next display_order."""
    display_order = start_order
    for item in mcq_questions:
        options = [
            (option_text, index == item.correct_index)
            for index, option_text in enumerate(item.options)
        ]
        await repo.add_mcq_question(test_id, item.question_text, display_order, options)
        display_order += 1
    for item in frq_questions:
        await repo.add_frq_question(test_id, item.question_text, display_order, item.expected_answer)
        display_order += 1
    return display_order


# Number of questions in the first streamed batch. Kept small so the very first
# question lands fast; the remainder is generated in a single follow-up call.
_FIRST_BATCH_SIZE = 5


async def _generate_questions_background(
    test_id: int,
    user_id: int,
    notes_content: str,
    practice_test_content: str,
    test_type: str,
    count_mcq: int,
    count_frq: int,
    is_math_mode: bool,
    difficulty: str,
    topic_focus: Optional[str],
    is_coding_mode: bool,
    coding_language: Optional[str],
    custom_instructions: Optional[str],
    provider: Optional[str],
    enable_fallback: bool,
    count_tf: int = 0,
    count_ms: int = 0,
    count_rank: int = 0,
    prior_questions: Optional[list[str]] = None,
) -> None:
    """Run LLM generation and save questions; called as a FastAPI background task.

    Connection discipline: NO DB session is held open across the LLM calls. Each
    batch is generated first (LLM only, no DB), then written in a short-lived
    session that is opened and closed immediately. Previously this task held one
    pooled connection open for the entire ~30-60s generation (across the LLM
    awaits), which starved concurrent requests such as GET /folders/{id}/tests
    and made the folder page hang on its loading spinner while a test generated.
    """
    _t0 = time.monotonic()
    llm = LLMService()

    # Dispatch a single generation call for the requested MCQ/FRQ counts. The three
    # source paths (template / parse / notes) each have their own LLM entry point
    # but share this MCQ/FRQ count contract. No DB access here.
    # on_question switches the call into streamed mode: each generated question is
    # delivered through the callback the moment it completes (parse path excluded;
    # it never streams).
    async def run_generation(
        c_mcq: int, c_frq: int, prior: Optional[list[str]], on_question=None
    ):
        if practice_test_content and notes_content:
            return await llm.generate_from_practice_test_template(
                notes=notes_content,
                practice_test_content=practice_test_content,
                test_type=test_type,
                count_mcq=c_mcq if test_type != "FRQ_only" else 0,
                count_frq=c_frq if test_type != "MCQ_only" else 0,
                is_math_mode=is_math_mode,
                difficulty=difficulty,
                topic_focus=topic_focus,
                is_coding_mode=is_coding_mode,
                coding_language=coding_language,
                custom_instructions=custom_instructions,
                provider=provider,
                enable_fallback=enable_fallback,
                prior_questions=prior,
                on_question=on_question,
            )
        if practice_test_content:
            # Parsing extracts questions from a fixed document and has no
            # cross-batch dedup, so this path is never split (see below).
            return await llm.parse_practice_test(
                content=practice_test_content,
                count_mcq=c_mcq if test_type != "FRQ_only" else 0,
                count_frq=c_frq if test_type != "MCQ_only" else 0,
                provider=provider,
            )
        return await llm.generate_test_questions(
            notes=notes_content,
            test_type=test_type,
            count_mcq=c_mcq,
            count_frq=c_frq,
            is_math_mode=is_math_mode,
            difficulty=difficulty,
            topic_focus=topic_focus,
            is_coding_mode=is_coding_mode,
            coding_language=coding_language,
            custom_instructions=custom_instructions,
            provider=provider,
            enable_fallback=enable_fallback,
            prior_questions=prior,
            on_question=on_question,
        )

    # Persist one MCQ/FRQ batch in a short-lived session, then release the
    # connection. Commits so pollers (separate sessions) see the batch immediately.
    async def persist_batch(mcq, frq, start_order: int) -> int:
        async with async_session_maker() as session:
            repo = TestRepository(session)
            next_order = await _persist_generated(repo, test_id, mcq, frq, start_order)
            await session.commit()
            return next_order

    try:
        # Effective MCQ/FRQ counts after applying test-type rules. Used to decide
        # the streaming split and the first-batch sizes.
        eff_mcq = 0 if test_type == "FRQ_only" else count_mcq
        eff_frq = 0 if test_type in ("MCQ_only", "Extreme") else count_frq
        total_main = eff_mcq + eff_frq

        # Stream in two phases (small first batch, then the rest) only when the test
        # is big enough to benefit and the source path supports cross-batch dedup.
        # parse_practice_test is single-phase to avoid duplicating extracted questions.
        is_parse_only = bool(practice_test_content) and not notes_content
        streaming = (not is_parse_only) and total_main > _FIRST_BATCH_SIZE

        display_order = 1
        if streaming:
            first_mcq = min(eff_mcq, _FIRST_BATCH_SIZE)
            first_frq = min(eff_frq, max(0, _FIRST_BATCH_SIZE - first_mcq))
            mcq1, frq1 = await run_generation(first_mcq, first_frq, prior_questions)
            display_order = await persist_batch(mcq1, frq1, display_order)
            logger.info(
                "Streamed first batch for test_id=%s: mcq=%d frq=%d",
                test_id, len(mcq1), len(frq1),
            )

            rest_mcq = max(0, eff_mcq - first_mcq)
            rest_frq = max(0, eff_frq - first_frq)
            if rest_mcq or rest_frq:
                # Feed the first batch's questions in as "already seen" so the
                # remainder does not repeat them (prompt novelty block + server-side
                # dedup in llm_service, GH #34).
                seen = [q.question_text for q in mcq1] + [q.question_text for q in frq1]
                prior_for_rest = (prior_questions or []) + seen

                # Questions 6+ arrive one at a time: the LLM response is token-
                # streamed and each question is committed the moment its JSON
                # object completes, so the polling take-test screen renders it
                # immediately instead of waiting for the whole remainder blob.
                def _norm(text: str) -> str:
                    return " ".join((text or "").split()).lower()

                persisted_keys: set[str] = set()

                async def persist_streamed_question(kind: str, item) -> None:
                    nonlocal display_order
                    async with async_session_maker() as q_session:
                        q_repo = TestRepository(q_session)
                        if kind == "mcq":
                            q_options = [
                                (option_text, index == item.correct_index)
                                for index, option_text in enumerate(item.options)
                            ]
                            await q_repo.add_mcq_question(
                                test_id, item.question_text, display_order, q_options
                            )
                        else:
                            await q_repo.add_frq_question(
                                test_id, item.question_text, display_order, item.expected_answer
                            )
                        await q_session.commit()
                    display_order += 1
                    persisted_keys.add(_norm(item.question_text))

                mcq2, frq2 = await run_generation(
                    rest_mcq, rest_frq, prior_for_rest,
                    on_question=persist_streamed_question,
                )
                # Safety net: some fallback returns inside the LLM service bypass
                # the callback (e.g. the note-based fallback built after an
                # exception). Persist anything returned that was not already
                # committed by the streamed callback.
                leftover_mcq = [q for q in mcq2 if _norm(q.question_text) not in persisted_keys]
                leftover_frq = [q for q in frq2 if _norm(q.question_text) not in persisted_keys]
                if leftover_mcq or leftover_frq:
                    display_order = await persist_batch(leftover_mcq, leftover_frq, display_order)
        else:
            mcq_questions, frq_questions = await run_generation(count_mcq, count_frq, prior_questions)
            display_order = await persist_batch(mcq_questions, frq_questions, display_order)

        # Extra (beta) question types. Isolated and best-effort: a failure here
        # must never break the MCQ/FRQ test that was already generated above.
        if count_tf or count_ms or count_rank:
            try:
                extra_source = notes_content or practice_test_content
                tf_questions, ms_questions, rank_questions = await llm.generate_extra_question_types(
                    notes=extra_source,
                    count_tf=count_tf,
                    count_ms=count_ms,
                    count_rank=count_rank,
                    difficulty=difficulty,
                    topic_focus=topic_focus,
                    custom_instructions=custom_instructions,
                    provider=provider,
                )
                async with async_session_maker() as session:
                    repo = TestRepository(session)
                    for tf_item in tf_questions:
                        await repo.add_tf_question(test_id, tf_item.question_text, display_order, tf_item.correct_answer)
                        display_order += 1
                    for ms_item in ms_questions:
                        ms_options = [
                            (option_text, index in ms_item.correct_indices)
                            for index, option_text in enumerate(ms_item.options)
                        ]
                        await repo.add_ms_question(test_id, ms_item.question_text, display_order, ms_options)
                        display_order += 1
                    for rank_item in rank_questions:
                        await repo.add_rank_question(test_id, rank_item.question_text, display_order, rank_item.items_in_correct_order)
                        display_order += 1
                    await session.commit()
                logger.info(
                    "Extra question types saved for test_id=%s: tf=%d ms=%d rank=%d",
                    test_id, len(tf_questions), len(ms_questions), len(rank_questions),
                )
            except Exception as extra_exc:
                logger.warning(
                    "Extra question types failed for test_id=%s (test still valid): %s",
                    test_id, extra_exc,
                )

        async with async_session_maker() as session:
            test = await session.get(Test, test_id)
            if test is not None:
                test.generation_status = "ready"
            duration_ms = int((time.monotonic() - _t0) * 1000)
            try:
                await UsageEventRepository(session).log_event(
                    user_id, "test_generation", duration_ms, provider=provider
                )
            except Exception:
                pass
            await session.commit()
        logger.info("Background test generation complete", extra={"test_id": test_id})
    except Exception as exc:
        logger.warning("Background test generation failed for test_id=%s: %s", test_id, exc)
        duration_ms = int((time.monotonic() - _t0) * 1000)
        error_label = type(exc).__name__
        async with async_session_maker() as err_session:
            test = await err_session.get(Test, test_id)
            if test is not None:
                test.generation_status = "failed"
                test.generation_error = str(exc)[:500]
            try:
                await UsageEventRepository(err_session).log_event(
                    user_id,
                    "test_generation",
                    duration_ms,
                    provider=provider,
                    success=False,
                    error_type=error_label[:50],
                )
            except Exception:
                pass
            await err_session.commit()


async def _extract_and_generate_background(
    test_id: int,
    user_id: int,
    folder_id: int,
    notes_bytes: list[Tuple[bytes, str]],
    practice_test_bytes: Optional[Tuple[bytes, str]],
    use_folder_files: bool,
    avoid_repeat: bool,
    test_type: str,
    count_mcq: int,
    count_frq: int,
    is_math_mode: bool,
    difficulty: str,
    topic_focus: Optional[str],
    is_coding_mode: bool,
    coding_language: Optional[str],
    custom_instructions: Optional[str],
    provider: Optional[str],
    enable_fallback: bool,
    count_tf: int = 0,
    count_ms: int = 0,
    count_rank: int = 0,
) -> None:
    """Extract uploaded files, persist notes, then run generation.

    File extraction (PDF parsing) is CPU-heavy, so it is done here in the
    background rather than on the create_test request. That lets the create
    endpoint return immediately and the UI land in the folder right away.
    """
    try:
        svc = FileService()
        # Extract file text first, holding NO DB connection (extraction can take
        # several seconds and runs in a worker thread).
        if notes_bytes:
            mock_files = [_BytesUploadFile(d, n) for d, n in notes_bytes]
            notes_content, _ = await svc.extract_from_files(mock_files)  # type: ignore[arg-type]
        else:
            notes_content = ""

        practice_test_content = ""
        if practice_test_bytes is not None:
            mock_pt = _BytesUploadFile(practice_test_bytes[0], practice_test_bytes[1])
            practice_test_content, _ = await svc.extract_from_files([mock_pt])  # type: ignore[arg-type]

        # Short-lived session: folder-file read + note writes only, then released.
        async with async_session_maker() as session:
            folder_files_content = (
                await svc.get_folder_files_content(folder_id, user_id, session)
                if use_folder_files
                else ""
            )
            combined_notes = "\n\n---\n\n".join(
                p for p in [notes_content, folder_files_content] if p
            )

            source_for_hash = combined_notes or practice_test_content
            notes_hash = (
                hashlib.sha256(source_for_hash.encode("utf-8")).hexdigest()
                if source_for_hash
                else None
            )

            repo = TestRepository(session)
            test = await session.get(Test, test_id)
            if test is None:
                return
            test.notes_hash = notes_hash
            if combined_notes:
                note_label = ", ".join(n for _, n in notes_bytes) or "folder files"
                await repo.add_note(test_id, note_label[:255], "combined", combined_notes)
            if practice_test_content:
                pt_label = practice_test_bytes[1] if practice_test_bytes else "practice_test"
                await repo.add_note(test_id, pt_label[:255], "pdf", practice_test_content)

            prior_questions: list[str] = []
            if notes_hash and avoid_repeat:
                prior_questions = await repo.get_prior_question_texts(
                    folder_id, notes_hash, exclude_test_id=test_id
                )
            await session.commit()
            # New test notes are part of Kojo's folder context.
            invalidate_folder(folder_id)
    except Exception as exc:
        logger.warning("File extraction failed for test_id=%s: %s", test_id, exc)
        async with async_session_maker() as err_session:
            test = await err_session.get(Test, test_id)
            if test is not None:
                test.generation_status = "failed"
                test.generation_error = f"Could not read your files: {exc}"[:500]
            await err_session.commit()
        return

    # Generation opens its own session and manages status (ready/failed) + streaming.
    await _generate_questions_background(
        test_id=test_id,
        user_id=user_id,
        notes_content=combined_notes,
        practice_test_content=practice_test_content,
        test_type=test_type,
        count_mcq=count_mcq,
        count_frq=count_frq,
        is_math_mode=is_math_mode,
        difficulty=difficulty,
        topic_focus=topic_focus,
        is_coding_mode=is_coding_mode,
        coding_language=coding_language,
        custom_instructions=custom_instructions,
        provider=provider,
        enable_fallback=enable_fallback,
        count_tf=count_tf,
        count_ms=count_ms,
        count_rank=count_rank,
        prior_questions=prior_questions,
    )


@router.post(
    "/folders/{folder_id}/tests",
    response_model=CreateTestResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/minute")
async def create_test(
    folder_id: int,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CreateTestResponse:
    try:
        form = await request.form()
        title = str(form.get("title", "")).strip()
        test_type = str(form.get("test_type", "")).strip()
        description_value = form.get("description")
        description = str(description_value).strip() if description_value else None
        notes_files = form.getlist("notes_files") if hasattr(form, "getlist") else []
        practice_test_raw = form.get("practice_test_file")
        practice_test_file = practice_test_raw if isinstance(practice_test_raw, UploadFile) else None

        try:
            count_mcq = max(0, min(50, int(str(form.get("count_mcq", "10")))))
        except (ValueError, TypeError):
            count_mcq = 10
        try:
            count_frq = max(0, min(50, int(str(form.get("count_frq", "5")))))
        except (ValueError, TypeError):
            count_frq = 5
        if test_type == "Extreme":
            count_frq = 0

        # Extra (beta) question types. Capped at 10 each to stay within the token
        # budget; absent/invalid values default to 0 so non-beta requests are unaffected.
        def _extra_count(field_name: str) -> int:
            try:
                return max(0, min(10, int(str(form.get(field_name, "0")))))
            except (ValueError, TypeError):
                return 0
        count_tf = _extra_count("count_tf")
        count_ms = _extra_count("count_ms")
        count_rank = _extra_count("count_rank")
        is_math_mode = str(form.get("is_math_mode", "false")).lower() in ("true", "1", "yes")
        difficulty_raw = str(form.get("difficulty", "mixed")).strip().lower()
        difficulty = difficulty_raw if difficulty_raw in ("easy", "medium", "hard", "mixed") else "mixed"
        topic_focus_raw = form.get("topic_focus")
        topic_focus = str(topic_focus_raw).strip()[:200] if topic_focus_raw else None
        is_coding_mode = str(form.get("is_coding_mode", "false")).lower() in ("true", "1", "yes")
        coding_language_raw = form.get("coding_language")
        coding_language = str(coding_language_raw).strip()[:50] if coding_language_raw else "Python"
        custom_instructions_raw = form.get("custom_instructions")
        custom_instructions = str(custom_instructions_raw).strip()[:500] if custom_instructions_raw else None
        provider_raw = form.get("provider")
        provider = str(provider_raw).strip().lower() if provider_raw else None
        provider_aliases = {"google": "gemini", "anthropic": "claude"}
        if provider:
            provider = provider_aliases.get(provider, provider)
            if provider not in ("auto", "groq", "gemini", "claude", "ollama"):
                raise StudyAppException(
                    "provider must be auto, groq, google, anthropic, gemini, claude, or ollama"
                )
        enable_fallback = str(form.get("enable_fallback", "true")).lower() not in ("false", "0", "no")

        if not title or not test_type:
            raise StudyAppException("title and test_type are required")
        folder = await session.scalar(
            select(Folder).where(Folder.id == folder_id, Folder.user_id == user.id)
        )
        if folder is None:
            raise ResourceNotFoundException("Folder")
        folder_file_count = await session.scalar(
            select(func.count()).select_from(FolderFile).where(FolderFile.folder_id == folder_id)
        )
        if not notes_files and practice_test_file is None and int(folder_file_count or 0) == 0:
            raise StudyAppException(
                "Provide at least one notes document, a saved folder file, or a practice test file"
            )
        valid_files = [f for f in notes_files if isinstance(f, UploadFile)]
        if len(valid_files) != len(notes_files):
            raise StudyAppException("All uploaded documents must be valid files")

        # ── Read file bytes NOW, before the request context ends ──────────────
        notes_bytes: list[Tuple[bytes, str]] = []
        total_size_bytes = 0
        for upload in valid_files:
            data = await upload.read()
            total_size_bytes += len(data)
            notes_bytes.append((data, upload.filename or "notes"))

        pt_bytes: Optional[Tuple[bytes, str]] = None
        if practice_test_file is not None:
            pt_data = await practice_test_file.read()
            pt_bytes = (pt_data, practice_test_file.filename or "practice_test")
            total_size_bytes += len(pt_data)

        if total_size_bytes > MAX_UPLOAD_TOTAL_SIZE_BYTES:
            raise StudyAppException(
                f"Combined uploaded files exceed the {MAX_UPLOAD_TOTAL_SIZE_BYTES // (1024 * 1024)} MB limit"
            )

        # ── Create the test shell and return immediately ─────────────────────
        # File extraction (PDF parsing) is CPU-heavy and used to run here, leaving
        # the user on a spinner. We now create the test record, return right away
        # so the UI lands in the folder, and do extraction + generation entirely in
        # the background. notes_hash is computed in the background once files are read.
        eff_mcq = 0 if test_type == "FRQ_only" else count_mcq
        eff_frq = 0 if test_type in ("MCQ_only", "Extreme") else count_frq

        repo = TestRepository(session)
        test = await repo.create(
            folder_id,
            title,
            test_type,
            description,
            is_math_mode=is_math_mode,
            is_coding_mode=is_coding_mode,
            coding_language=coding_language,
            notes_hash=None,
        )
        test.generation_status = "generating"
        # Record how many questions this test will end up with so the take-test screen
        # can show streaming progress while the background task fills them in.
        test.expected_question_count = eff_mcq + eff_frq + count_tf + count_ms + count_rank
        await session.commit()

        # ── Schedule extraction + LLM generation off the request cycle ────────
        # Detached via asyncio.create_task (NOT FastAPI BackgroundTasks) so the
        # 201 response frees this HTTP connection immediately. See _spawn_generation.
        _spawn_generation(
            _extract_and_generate_background(
                test_id=test.id,
                user_id=user.id,
                folder_id=folder_id,
                notes_bytes=notes_bytes,
                practice_test_bytes=pt_bytes,
                use_folder_files=(not notes_bytes),
                avoid_repeat=bool(getattr(folder, "avoid_repeat_questions", False)),
                test_type=test_type,
                count_mcq=count_mcq,
                count_frq=count_frq,
                is_math_mode=is_math_mode,
                difficulty=difficulty,
                topic_focus=topic_focus,
                is_coding_mode=is_coding_mode,
                coding_language=coding_language,
                custom_instructions=custom_instructions,
                provider=provider,
                enable_fallback=enable_fallback,
                count_tf=count_tf,
                count_ms=count_ms,
                count_rank=count_rank,
            )
        )

        return CreateTestResponse(
            test_id=test.id,
            title=test.title,
            questions_generated=0,
            message="Your test is being generated. It'll be ready shortly.",
            generation_status="generating",
        )

    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/tests/{test_id}/regenerate", response_model=CreateTestResponse)
@limiter.limit("5/minute")
async def regenerate_test(
    request: Request,
    response: Response,
    test_id: int,
    data: RegenerateTestRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CreateTestResponse:
    """Re-run question generation for an existing test, reusing its stored notes.

    This is the one-click "Retry" path for a test that failed or generated nothing.
    It reuses the notes persisted on the test (no re-upload), clears any stale
    questions, resets the test to "generating", and schedules a fresh background run.
    """
    try:
        repo = TestRepository(session)
        test = await repo.get_owned_with_questions(test_id, user.id)
        if test is None:
            raise ResourceNotFoundException("Test")

        # Reconstruct the source material from the persisted Note rows. create_test
        # stores combined notes under file_type "combined" and a practice test under "pdf".
        notes_content = "\n\n---\n\n".join(
            n.content for n in test.notes if n.file_type != "pdf" and n.content
        )
        practice_test_content = "\n\n---\n\n".join(
            n.content for n in test.notes if n.file_type == "pdf" and n.content
        )
        if not notes_content and not practice_test_content:
            raise StudyAppException(
                "This test has no saved notes to regenerate from. Create a new test and re-upload your notes."
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

        difficulty = data.difficulty.strip().lower()
        if difficulty not in ("easy", "medium", "hard", "mixed"):
            difficulty = "mixed"

        count_frq = data.count_frq if test.test_type != "Extreme" else 0

        # Clear stale questions (blank placeholders or a partial prior run) before regenerating.
        for question in list(test.questions):
            await repo.delete_question(question)

        test.generation_status = "generating"
        test.generation_error = None
        eff_mcq = 0 if test.test_type == "FRQ_only" else data.count_mcq
        eff_frq = 0 if test.test_type in ("MCQ_only", "Extreme") else count_frq
        test.expected_question_count = (
            eff_mcq + eff_frq + data.count_tf + data.count_ms + data.count_rank
        )

        prior_questions: list[str] = []
        if test.notes_hash:
            folder = test.folder
            if folder is not None and getattr(folder, "avoid_repeat_questions", False):
                prior_questions = await repo.get_prior_question_texts(
                    test.folder_id, test.notes_hash, exclude_test_id=test.id
                )

        await session.commit()

        _spawn_generation(
            _generate_questions_background(
                test_id=test.id,
                user_id=user.id,
                notes_content=notes_content,
                practice_test_content=practice_test_content,
                test_type=test.test_type,
                count_mcq=data.count_mcq,
                count_frq=count_frq,
                is_math_mode=test.is_math_mode,
                difficulty=difficulty,
                topic_focus=(data.topic_focus.strip()[:200] if data.topic_focus else None),
                is_coding_mode=test.is_coding_mode,
                coding_language=test.coding_language or "Python",
                custom_instructions=(data.custom_instructions.strip()[:500] if data.custom_instructions else None),
                provider=provider,
                enable_fallback=data.enable_fallback,
                count_tf=data.count_tf,
                count_ms=data.count_ms,
                count_rank=data.count_rank,
                prior_questions=prior_questions,
            )
        )

        return CreateTestResponse(
            test_id=test.id,
            title=test.title,
            questions_generated=0,
            message="Regenerating your test. Check back in a moment.",
            generation_status="generating",
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tests", response_model=list[TestSummary])
async def list_all_tests(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[TestSummary]:
    return await TestService().list_tests_for_user(user.id, session)


@router.get("/folders/{folder_id}/tests", response_model=list[TestSummary])
async def list_tests(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[TestSummary]:
    try:
        return await TestService().list_tests(folder_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/tests/{test_id}", response_model=TestTakeResponse)
async def get_test(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TestTakeResponse:
    try:
        return await TestService().get_test_for_taking(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/tests/{test_id}", response_model=TestResponse)
async def update_test(
    test_id: int,
    data: TestUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TestResponse:
    try:
        return await TestService().update_test(test_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await TestService().delete_test(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/tests/{test_id}/progress", response_model=list[WeaknessResponse])
async def get_test_progress(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[WeaknessResponse]:
    try:
        return await GradingService().get_weakness_detection(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/tests/{test_id}/edit", response_model=list[QuestionEditable])
async def get_questions_for_editing(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[QuestionEditable]:
    try:
        return await TestService().get_questions_for_editing(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/tests/{test_id}/questions",
    response_model=QuestionEditable,
    status_code=status.HTTP_201_CREATED,
)
async def add_question(
    test_id: int,
    data: QuestionCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> QuestionEditable:
    try:
        return await TestService().add_question(test_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/tests/{test_id}/questions/{question_id}", response_model=QuestionEditable)
async def update_question(
    test_id: int,
    question_id: int,
    data: QuestionUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> QuestionEditable:
    try:
        return await TestService().update_question(question_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/tests/{test_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    test_id: int,
    question_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await TestService().delete_question(question_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
