"""Learning module tools for the Nosey MCP connector (article tracks).

The connected app writes every lesson, narration script and quiz; Nosey
stores them in the same shape its own generator does, so the lesson reader,
narration highlight and 80% unlock gate all work unchanged.

Agreed rules (.claude/todos-features/todo-mcp-connector.md):
- 1 to 20 modules per track, lessons of any length, 3 to 10 quiz questions.
- Creating a track in a folder that already has an active article track
  ARCHIVES the old one (kept, restorable), it is never overwritten.
- Quiz explanations are required: a quiz without them gets backfilled by
  Nosey's own LLM on first submit, which this connector must not cause.
- Podcast / video lecture formats are not covered yet.
"""
from __future__ import annotations

import json
from typing import Any, Optional
from urllib.parse import urlsplit

from pydantic import Field, ValidationError, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.models.folder import Folder
from src.models.learning_module import LearningModule, LearningTrack
from src.services.mcp_tool_base import McpContext, McpTool, ToolArgs, ToolInputError, owned_folder
from src.services.mcp_write_tools import CONFIRM_FIELD, CREATED_VIA, require_confirm, screen
from src.utils.exceptions import ResourceNotFoundException
from src.utils.lesson_blocks import normalize_tts_script, split_lesson_blocks

ARTICLE = "article"
MAX_MODULES_PER_TRACK = 20
MAX_LESSON_CHARS = 100_000


class QuizQuestionIn(ToolArgs):
    question: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0, description="0-based index into options.")
    explanation: str = Field(
        min_length=1, max_length=4000, description="Why the answer is right; shown when the student misses it."
    )

    @model_validator(mode="after")
    def _check(self) -> "QuizQuestionIn":
        if self.correct_index >= len(self.options):
            raise ValueError("correct_index must point at one of the options")
        if any(not o.strip() for o in self.options):
            raise ValueError("options cannot be empty")
        return self


class ModuleIn(ToolArgs):
    title: str = Field(min_length=1, max_length=255)
    summary: Optional[str] = Field(default=None, max_length=1000)
    lesson_markdown: str = Field(
        min_length=1, max_length=MAX_LESSON_CHARS, description="The lesson. Markdown, LaTeX in $...$, any length."
    )
    narration: Optional[list[str]] = Field(
        default=None,
        description="Optional read-aloud script: one spoken entry per lesson paragraph (paragraphs are split "
        "on blank lines; a fenced code block or $$ block counts as one). Omit to read the lesson text itself.",
    )
    quiz: list[QuizQuestionIn] = Field(
        min_length=3, max_length=10, description="Passing needs 80%; passing unlocks the next module."
    )
    video_url: Optional[str] = Field(default=None, max_length=500, description="Optional YouTube/Vimeo/video link.")

    @model_validator(mode="after")
    def _check(self) -> "ModuleIn":
        _check_narration(self.narration, self.lesson_markdown)
        _check_video(self.video_url)
        return self

    def texts(self) -> list[Optional[str]]:
        quiz = [t for q in self.quiz for t in (q.question, q.explanation, *q.options)]
        return [self.title, self.summary, self.lesson_markdown, *(self.narration or []), *quiz]


def _check_narration(narration: Optional[list[str]], lesson: str) -> None:
    if narration is None:
        return
    blocks = len(split_lesson_blocks(lesson))
    if len(narration) != blocks:
        raise ValueError(
            f"narration needs exactly one entry per lesson paragraph: the lesson has {blocks}, got {len(narration)}"
        )


def _check_video(url: Optional[str]) -> None:
    if url and urlsplit(url.strip()).scheme not in ("http", "https"):
        raise ValueError("video_url must be an http(s) link")


def _quiz_json(quiz: list[QuizQuestionIn]) -> str:
    return json.dumps(
        [
            {"question": q.question, "options": q.options, "correct_index": q.correct_index, "explanation": q.explanation}
            for q in quiz
        ],
        ensure_ascii=False,
    )


def _new_module(track_id: int, order_index: int, m: ModuleIn) -> LearningModule:
    return LearningModule(
        track_id=track_id,
        order_index=order_index,
        title=m.title.strip(),
        summary=m.summary,
        lesson_content=m.lesson_markdown,
        tts_script=normalize_tts_script(m.narration) or None if m.narration is not None else None,
        quiz_json=_quiz_json(m.quiz),
        video_url=(m.video_url or "").strip() or None,
    )


async def _owned_track(ctx: McpContext, track_id: int) -> LearningTrack:
    track = await ctx.session.scalar(
        select(LearningTrack)
        .join(Folder, Folder.id == LearningTrack.folder_id)
        .where(LearningTrack.id == track_id, Folder.user_id == ctx.user.id)
        .options(selectinload(LearningTrack.modules))
    )
    if track is None:
        raise ResourceNotFoundException("Learning track")
    return track


def _track_summary(track: LearningTrack, modules: list[LearningModule]) -> dict[str, Any]:
    return {
        "track_id": track.id,
        "folder_id": track.folder_id,
        "modules": [{"module_id": m.id, "order_index": m.order_index, "title": m.title} for m in modules],
    }


# ---------------------------------------------------------------- tools

class CreateTrackArgs(ToolArgs):
    folder_id: int
    modules: list[ModuleIn] = Field(min_length=1, max_length=MAX_MODULES_PER_TRACK, description="In study order.")


async def create_learning_track(ctx: McpContext, args: CreateTrackArgs) -> dict[str, Any]:
    folder = await owned_folder(ctx, args.folder_id)
    await screen(ctx, *(t for m in args.modules for t in m.texts()))
    # One active track per folder and format (partial unique index): the old
    # one is archived, never overwritten, so the user's progress survives.
    previous = (
        await ctx.session.scalars(
            select(LearningTrack).where(
                LearningTrack.folder_id == folder.id,
                LearningTrack.format == ARTICLE,
                LearningTrack.is_archived.is_(False),
            )
        )
    ).all()
    for old in previous:
        old.is_archived = True
    await ctx.session.flush()
    track = LearningTrack(
        folder_id=folder.id,
        status="ready",
        module_count=len(args.modules),
        format=ARTICLE,
        is_archived=False,
        created_via=CREATED_VIA,
    )
    ctx.session.add(track)
    await ctx.session.flush()
    modules = [_new_module(track.id, i, m) for i, m in enumerate(args.modules)]
    ctx.session.add_all(modules)
    await ctx.session.commit()
    return {**_track_summary(track, modules), "archived_track_ids": [t.id for t in previous]}


class AddModulesArgs(ToolArgs):
    track_id: int
    modules: list[ModuleIn] = Field(min_length=1, max_length=MAX_MODULES_PER_TRACK)


async def add_modules(ctx: McpContext, args: AddModulesArgs) -> dict[str, Any]:
    track = await _owned_track(ctx, args.track_id)
    if track.format != ARTICLE:
        raise ToolInputError("Modules can only be added to article tracks.")
    if len(track.modules) + len(args.modules) > MAX_MODULES_PER_TRACK:
        raise ToolInputError(
            f"A track holds at most {MAX_MODULES_PER_TRACK} modules; it has {len(track.modules)}."
        )
    await screen(ctx, *(t for m in args.modules for t in m.texts()))
    start = await ctx.session.scalar(
        select(func.coalesce(func.max(LearningModule.order_index), -1)).where(LearningModule.track_id == track.id)
    )
    modules = [_new_module(track.id, int(start) + 1 + i, m) for i, m in enumerate(args.modules)]
    ctx.session.add_all(modules)
    track.module_count = len(track.modules) + len(modules)
    await ctx.session.commit()
    return _track_summary(track, modules)


class EditModuleArgs(ToolArgs):
    module_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    summary: Optional[str] = Field(default=None, max_length=1000)
    lesson_markdown: Optional[str] = Field(default=None, min_length=1, max_length=MAX_LESSON_CHARS)
    narration: Optional[list[str]] = Field(
        default=None, description="One entry per lesson paragraph. Send null to read the lesson text itself."
    )
    quiz: Optional[list[QuizQuestionIn]] = Field(default=None, min_length=3, max_length=10)
    video_url: Optional[str] = Field(default=None, max_length=500, description="Send an empty string to remove.")


async def edit_module(ctx: McpContext, args: EditModuleArgs) -> dict[str, Any]:
    module = await _owned_module(ctx, args.module_id)
    fields = args.model_fields_set
    lesson = args.lesson_markdown if args.lesson_markdown is not None else (module.lesson_content or "")
    try:
        if "narration" in fields:
            _check_narration(args.narration, lesson)
        _check_video(args.video_url)
    except ValueError as exc:
        raise ToolInputError(str(exc)) from exc
    await screen(
        ctx,
        args.title,
        args.summary,
        args.lesson_markdown,
        *(args.narration or []),
        *(t for q in args.quiz or [] for t in (q.question, q.explanation, *q.options)),
    )

    if args.title is not None:
        module.title = args.title.strip()
    if "summary" in fields:
        module.summary = args.summary
    if args.lesson_markdown is not None:
        module.lesson_content = args.lesson_markdown
        if "narration" not in fields:
            # The old script narrates the old lesson; read the new text instead.
            module.tts_script = None
    if "narration" in fields:
        module.tts_script = normalize_tts_script(args.narration) or None if args.narration is not None else None
    if args.quiz is not None:
        # Progress (best_score, passed) is kept, as when the user edits a module.
        module.quiz_json = _quiz_json(args.quiz)
    if args.video_url is not None:
        module.video_url = args.video_url.strip() or None
    await ctx.session.commit()
    return {"module_id": module.id, "updated": sorted(fields - {"module_id"})}


class EditQuizQuestionArgs(ToolArgs):
    module_id: int
    question_index: int = Field(ge=0, description="0-based position in the quiz list get_learning_module returns.")
    question: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    options: Optional[list[str]] = Field(
        default=None, min_length=2, max_length=6, description="Replaces all options; send correct_index with it."
    )
    correct_index: Optional[int] = Field(default=None, ge=0, description="0-based index into options.")
    explanation: Optional[str] = Field(
        default=None, min_length=1, max_length=4000,
        description="The feedback shown when the student misses this question.",
    )


async def _owned_module(ctx: McpContext, module_id: int) -> LearningModule:
    module = await ctx.session.scalar(
        select(LearningModule)
        .join(LearningTrack, LearningTrack.id == LearningModule.track_id)
        .join(Folder, Folder.id == LearningTrack.folder_id)
        .where(LearningModule.id == module_id, Folder.user_id == ctx.user.id)
    )
    if module is None:
        raise ResourceNotFoundException("Learning module")
    return module


async def edit_quiz_question(ctx: McpContext, args: EditQuizQuestionArgs) -> dict[str, Any]:
    module = await _owned_module(ctx, args.module_id)
    try:
        quiz = json.loads(module.quiz_json or "[]")
    except ValueError:
        quiz = []
    if not isinstance(quiz, list) or not quiz:
        raise ToolInputError("This module has no quiz yet. Use edit_module to write one.")
    if args.question_index >= len(quiz):
        raise ToolInputError(f"question_index must be 0 to {len(quiz) - 1}: the quiz has {len(quiz)} questions.")
    if args.options is not None and args.correct_index is None:
        raise ToolInputError("Send correct_index together with new options.")

    current = quiz[args.question_index]
    merged = {
        "question": args.question if args.question is not None else current.get("question", ""),
        "options": args.options if args.options is not None else current.get("options", []),
        "correct_index": args.correct_index if args.correct_index is not None else current.get("correct_index", 0),
        "explanation": args.explanation if args.explanation is not None else current.get("explanation") or "",
    }
    if not merged["explanation"]:
        # A missing explanation is backfilled by Nosey's LLM on submit, which the connector must not cause.
        raise ToolInputError("This question has no explanation yet; send one.")
    try:
        checked = QuizQuestionIn.model_validate(merged)
    except ValidationError as exc:
        raise ToolInputError(str(exc)) from exc
    await screen(ctx, args.question, args.explanation, *(args.options or []))

    quiz[args.question_index] = {**current, **checked.model_dump()}
    module.quiz_json = json.dumps(quiz, ensure_ascii=False)
    await ctx.session.commit()
    # Progress (best_score, passed) is kept, as with edit_module.
    return {"module_id": module.id, "question_index": args.question_index, "question": quiz[args.question_index]}


class ArchiveTrackArgs(ToolArgs):
    track_id: int
    archived: bool = Field(default=True, description="false restores an archived track.")


async def archive_track(ctx: McpContext, args: ArchiveTrackArgs) -> dict[str, Any]:
    track = await _owned_track(ctx, args.track_id)
    if not args.archived and track.is_archived:
        active = await ctx.session.scalar(
            select(LearningTrack.id).where(
                LearningTrack.folder_id == track.folder_id,
                LearningTrack.format == track.format,
                LearningTrack.is_archived.is_(False),
            )
        )
        if active is not None:
            raise ToolInputError(
                f"The folder already has an active {track.format} track (track_id {active}). Archive it first."
            )
    track.is_archived = args.archived
    await ctx.session.commit()
    return {"track_id": track.id, "is_archived": track.is_archived}


class DeleteTrackArgs(ToolArgs):
    track_id: int
    confirm: bool = CONFIRM_FIELD


async def delete_track(ctx: McpContext, args: DeleteTrackArgs) -> dict[str, Any]:
    require_confirm(args.confirm)
    track = await _owned_track(ctx, args.track_id)
    await ctx.session.delete(track)
    await ctx.session.commit()
    return {"deleted_track_id": args.track_id}


def _write(name: str, title: str, description: str, args, handler, destructive: bool = False) -> McpTool:
    return McpTool(name, title, description, args, handler, read_only=False, destructive=destructive)


LEARNING_TOOLS: tuple[McpTool, ...] = (
    _write(
        "create_learning_track",
        "Create a learning track",
        "Create an article learning track from modules you write: lesson, optional narration, quiz "
        "(3 to 10 questions, each with an explanation) and optional video. The student must score 80% "
        "on a module's quiz to unlock the next. If the folder already has an active article track, it "
        "is archived (kept and restorable), not overwritten.",
        CreateTrackArgs,
        create_learning_track,
    ),
    _write("add_modules", "Add learning modules", "Append modules to an article track (20 per track at most).",
           AddModulesArgs, add_modules),
    _write(
        "edit_module",
        "Edit a learning module",
        "Change a module's title, summary, lesson, narration, quiz or video. Changing the lesson without "
        "new narration makes the reader read the new lesson text. The student's progress is kept.",
        EditModuleArgs,
        edit_module,
    ),
    _write(
        "edit_quiz_question",
        "Edit one quiz question",
        "Change one question of a module's quiz in place: its text, options and answer, or just the "
        "explanation (the feedback shown when the student misses it). The rest of the quiz and the "
        "student's progress are kept. Read the quiz with get_learning_module first.",
        EditQuizQuestionArgs,
        edit_quiz_question,
    ),
    _write("archive_track", "Archive a learning track",
           "Archive a track, or restore one with archived=false.", ArchiveTrackArgs, archive_track),
    _write("delete_track", "Delete a learning track",
           "Delete a track and all its modules and progress. Needs confirm=true.", DeleteTrackArgs, delete_track,
           destructive=True),
)
