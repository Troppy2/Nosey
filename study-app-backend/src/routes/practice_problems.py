"""Practice-test problem picker and review step for Create Test (GH #138).

Lists an uploaded practice test's problems, reads only the picked ones into
draft questions, and redoes one problem from the student's correction. Drafts
are never saved here: they live in the browser until Create Test.

No `from __future__ import annotations` in this module: slowapi's limiter
wrapper hides the module globals, so FastAPI could not resolve string
annotations and treated the JSON bodies as query parameters (422).
"""
from dataclasses import asdict, replace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.models.folder_file import FolderFile
from src.models.user import User
from src.routes.folder_files import _get_owned_folder
from src.services.file_service import FileService
from src.services.llm_service import GeneratedFRQ, GeneratedMCQ, LLMService
from src.services.practice_problems import (
    answer_key_text,
    mark_lookalikes,
    problem_text,
    problems_from_starts,
    split_problems,
)
from src.utils.exceptions import LLMException
from src.utils.logger import get_logger
from src.utils.provider_policy import resolve_request_provider
from src.utils.usage_context import bind_usage

logger = get_logger(__name__)
# Below this many problems the picker is short enough without sections.
_MIN_PROBLEMS_FOR_TOPICS = 8

router = APIRouter(prefix="/folders", tags=["practice-problems"])

# Problems read in one review-step parse call.
MAX_PICKED_PROBLEMS = 150


async def _ready_practice_file(
    folder_id: int, file_id: int, user: User, session: AsyncSession
) -> FolderFile:
    await _get_owned_folder(folder_id, user, session)
    record = await session.scalar(
        select(FolderFile).where(FolderFile.id == file_id, FolderFile.folder_id == folder_id)
    )
    if record is None:
        raise HTTPException(status_code=404, detail="File not found")
    if record.upload_status == "processing":
        raise HTTPException(status_code=409, detail="This file is still being read.")
    if record.upload_status == "error":
        raise HTTPException(status_code=400, detail=record.upload_error or "This file could not be read.")
    return record


def _range_text(content: str, start: int, end: int) -> str:
    if not (0 <= start < end <= len(content)):
        raise HTTPException(status_code=400, detail="That problem is not in this file. Reload the file and try again.")
    return problem_text(content, start, end)


class PracticeProblemResponse(BaseModel):
    index: int
    label: str
    title: str
    chapter: Optional[str] = None
    preview: str
    part_count: int
    start: int
    end: int
    similar_to: Optional[str] = None


class PracticeProblemsResponse(BaseModel):
    # "headings": found by text rules; "ai": the AI index pass; "none": no
    # problems found, the whole document is used.
    source: str
    problems: list[PracticeProblemResponse]


@router.get("/{folder_id}/files/{file_id}/problems", response_model=PracticeProblemsResponse)
@limiter.limit("10/minute")
async def get_practice_problems(
    folder_id: int,
    file_id: int,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> PracticeProblemsResponse:
    """The problems of a practice test, for the Create Test picker (GH #138).

    Text rules first (free). A document with no problem headings gets one AI
    index pass; if that finds nothing either, the list is empty and the whole
    document is parsed as before.
    """
    record = await _ready_practice_file(folder_id, file_id, user, session)
    content = record.content or ""
    await session.close()
    problems = split_problems(content)
    source = "headings"
    if not problems and content.strip():
        bind_usage(user.id, "practice_index")
        try:
            starts = await LLMService().index_practice_problems(
                content, provider=resolve_request_provider(user, None)
            )
        except Exception as exc:
            logger.warning("AI problem index failed for file %s: %s", file_id, exc)
            starts = []
        problems = [p for p in problems_from_starts(content, starts) if p.preview]
        problems = [replace(p, index=i) for i, p in enumerate(problems)]
        source = "ai"
    # A long sheet with no chapters of its own gets topic sections (GH #165):
    # one small call, and the flat list if it fails.
    if len(problems) >= _MIN_PROBLEMS_FOR_TOPICS and not any(p.chapter for p in problems):
        bind_usage(user.id, "practice_topics")
        problems = await LLMService().group_practice_topics(
            problems, content, provider=resolve_request_provider(user, None)
        )
    else:
        problems = mark_lookalikes(problems, content)
    return PracticeProblemsResponse(
        source=source if problems else "none",
        problems=[PracticeProblemResponse(**asdict(p)) for p in problems],
    )


class DraftQuestion(BaseModel):
    kind: str  # "mcq" or "frq"
    question_text: str
    options: Optional[list[str]] = None
    correct_index: Optional[int] = None
    expected_answer: Optional[str] = None
    answer_inferred: bool = False
    # Multi-part problems (GH #151): set on each lettered part. The setup is
    # repeated on every part of a problem here and stored once at Create Test.
    part_label: Optional[str] = None
    group_key: Optional[str] = None
    group_label: str = ""
    group_stem: str = ""


def _drafts(mcq: list[GeneratedMCQ], frq: list[GeneratedFRQ]) -> list[DraftQuestion]:
    """Drafts in document order, so a problem's parts read (a), (b), (c)."""
    def grouping(q) -> dict:
        return {
            "part_label": q.part_label, "group_key": q.group_key,
            "group_label": q.group_label, "group_stem": q.group_stem,
        }

    items = [
        (q.seq, DraftQuestion(
            kind="mcq", question_text=q.question_text, options=q.options,
            correct_index=q.correct_index, answer_inferred=q.answer_inferred, **grouping(q),
        ))
        for q in mcq
    ] + [
        (q.seq, DraftQuestion(
            kind="frq", question_text=q.question_text,
            expected_answer=q.expected_answer, answer_inferred=q.answer_inferred, **grouping(q),
        ))
        for q in frq
    ]
    if any(seq is not None for seq, _ in items):
        last = max((seq for seq, _ in items if seq is not None), default=0) + 1
        items.sort(key=lambda pair: pair[0] if pair[0] is not None else last)
    return [draft for _, draft in items]


class ProblemRange(BaseModel):
    index: int
    label: str = ""
    start: int
    end: int


class ParseProblemsRequest(BaseModel):
    problems: list[ProblemRange]


class ParsedProblem(BaseModel):
    index: int
    source_text: str
    questions: list[DraftQuestion]
    # Set when the AI could not read this problem; the student can Fix it.
    error: Optional[str] = None


class ParseProblemsResponse(BaseModel):
    problems: list[ParsedProblem]


@router.post("/{folder_id}/files/{file_id}/problems/parse", response_model=ParseProblemsResponse)
@limiter.limit("6/minute")
async def parse_practice_problems(
    folder_id: int,
    file_id: int,
    payload: ParseProblemsRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ParseProblemsResponse:
    """Read only the picked problems into draft questions for the review step.

    Nothing is saved: the drafts live in the browser until Create Test.
    """
    if not payload.problems:
        raise HTTPException(status_code=400, detail="Pick at least one problem.")
    if len(payload.problems) > MAX_PICKED_PROBLEMS:
        raise HTTPException(status_code=400, detail=f"Pick at most {MAX_PICKED_PROBLEMS} problems at a time.")
    record = await _ready_practice_file(folder_id, file_id, user, session)
    content = record.content or ""
    items = [(p.index, p.label, _range_text(content, p.start, p.end)) for p in payload.problems]
    notes = await _solve_notes(folder_id, file_id, user, session)
    await session.close()
    bind_usage(user.id, "practice_parse")
    llm = LLMService()
    results = await llm.parse_practice_problems(
        items, answer_key=answer_key_text(content), provider=resolve_request_provider(user, None)
    )
    if all(result is None for result in results.values()):
        raise HTTPException(
            status_code=503, detail="Nosey couldn't read those problems right now. Try again in a moment."
        )
    results = await _solve_drafts(llm, results, notes)
    return ParseProblemsResponse(problems=[
        ParsedProblem(
            index=index,
            source_text=text,
            questions=_drafts(*results[index]) if results.get(index) else [],
            error=None if results.get(index) else "Nosey couldn't read this one. Use Fix it to paste it in.",
        )
        for index, _label, text in items
    ])


async def _solve_notes(folder_id: int, file_id: int, user: User, session: AsyncSession) -> str:
    """The folder's other files, read by the solver for notation only."""
    other_ids = list(await session.scalars(
        select(FolderFile.id).where(
            FolderFile.folder_id == folder_id,
            FolderFile.id != file_id,
            FolderFile.upload_status == "ready",
        )
    ))
    if not other_ids:
        return ""
    return await FileService().get_folder_files_content(folder_id, user.id, session, file_ids=other_ids)


async def _solve_drafts(
    llm: LLMService,
    results: dict[int, Optional[tuple[list[GeneratedMCQ], list[GeneratedFRQ]]]],
    notes: str,
) -> dict[int, Optional[tuple[list[GeneratedMCQ], list[GeneratedFRQ]]]]:
    """Work out the answers the document lacks, here in the review step.

    Solving at Create Test made Generate slow (every keyless question on the
    strongest model) and could change an answer the student had already
    approved. Solved here, the answer shown in review is the one graded.
    """
    owners_mcq: list[int] = []
    owners_frq: list[int] = []
    all_mcq: list[GeneratedMCQ] = []
    all_frq: list[GeneratedFRQ] = []
    for index, result in results.items():
        if result is None:
            continue
        for q in result[0]:
            owners_mcq.append(index)
            all_mcq.append(q)
        for q in result[1]:
            owners_frq.append(index)
            all_frq.append(q)
    solved_mcq, solved_frq = await llm._solve_keyless_questions(all_mcq, all_frq, notes)
    out: dict[int, Optional[tuple[list[GeneratedMCQ], list[GeneratedFRQ]]]] = {
        index: (None if result is None else ([], [])) for index, result in results.items()
    }
    for index, q in zip(owners_mcq, solved_mcq):
        out[index][0].append(q)
    for index, q in zip(owners_frq, solved_frq):
        out[index][1].append(q)
    return out


class FixProblemRequest(BaseModel):
    start: int
    end: int
    current: list[DraftQuestion] = []
    message: str
    # The picked problem's index and label, so a fixed problem keeps its group.
    index: Optional[int] = None
    label: str = ""


class FixProblemResponse(BaseModel):
    questions: list[DraftQuestion]


def _draft_text(questions: list[DraftQuestion]) -> str:
    lines: list[str] = []
    stem = next((q.group_stem for q in questions if q.group_stem), "")
    if stem:
        lines.append(f"Setup: {stem}")
    for n, q in enumerate(questions, start=1):
        part = f" part ({q.part_label})" if q.part_label else ""
        lines.append(f"Q{n}{part} ({'multiple choice' if q.kind == 'mcq' else 'written'}): {q.question_text}")
        for j, option in enumerate(q.options or []):
            mark = " (correct)" if j == q.correct_index else ""
            lines.append(f"   {chr(65 + j)}. {option}{mark}")
        if q.expected_answer:
            lines.append(f"   Answer: {q.expected_answer}")
    return "\n".join(lines) or "(nothing could be read)"


@router.post("/{folder_id}/files/{file_id}/problems/fix", response_model=FixProblemResponse)
@limiter.limit("20/minute")
async def fix_practice_problem(
    folder_id: int,
    file_id: int,
    payload: FixProblemRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FixProblemResponse:
    """Redo one problem from the student's instruction or pasted text."""
    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Say what's wrong, or paste the problem.")
    record = await _ready_practice_file(folder_id, file_id, user, session)
    content = record.content or ""
    source = _range_text(content, payload.start, payload.end)
    notes = await _solve_notes(folder_id, file_id, user, session)
    await session.close()
    bind_usage(user.id, "practice_parse")
    llm = LLMService()
    try:
        mcq, frq = await llm.fix_practice_problem(
            source, _draft_text(payload.current), message[:8_000],
            answer_key=answer_key_text(content), provider=resolve_request_provider(user, None),
            label=payload.label,
        )
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # An answer the student gave in the message counts as from the document,
    # so only the rest is solved.
    mcq, frq = await llm._solve_keyless_questions(mcq, frq, notes)
    # Same group key the parse step gave this problem; without an index, a key
    # no other problem can share.
    key = f"p{payload.index}:" if payload.index is not None else f"fix{payload.start}:"
    mcq = [replace(q, group_key=key + q.group_label) if q.group_key else q for q in mcq]
    frq = [replace(q, group_key=key + q.group_label) if q.group_key else q for q in frq]
    return FixProblemResponse(questions=_drafts(mcq, frq))
