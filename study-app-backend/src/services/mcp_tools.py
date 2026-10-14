"""Tools the Nosey MCP connector exposes to AI apps (Claude, ChatGPT).

The connecting app's own model writes the study content; Nosey only reads the
user's library (this module) and validates and saves what the model wrote
(mcp_write_tools). No tool calls Nosey's LLM providers. The registry and
call_tool live here; shared types are in mcp_tool_base.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import HTTPException
from limits import parse as parse_limit
from pydantic import Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.learning_module import LearningModule, LearningTrack
from src.limiter import limiter
from src.repositories.test_repository import TestRepository
from src.services.flashcard_service import FlashcardService
from src.services.folder_service import FolderService
from src.services.grading_service import GradingService
from src.services.mcp_tool_base import McpContext, McpTool, ToolArgs, dump, owned_folder
from src.services.mcp_learning_tools import LEARNING_TOOLS
from src.services.mcp_write_tools import WRITE_TOOLS
from src.services.test_service import TestService
from src.utils.exceptions import ResourceNotFoundException, StudyAppException

logger = logging.getLogger(__name__)

NOTE_PREVIEW_CHARS = 300
NOTE_PAGE_DEFAULT = 40_000
NOTE_PAGE_MAX = 100_000


# ---------------------------------------------------------------- folders

class ListFoldersArgs(ToolArgs):
    include_archived: bool = Field(default=False, description="Also list archived folders.")


async def list_folders(ctx: McpContext, args: ListFoldersArgs) -> dict[str, Any]:
    service = FolderService()
    folders = await service.list_folders(ctx.user.id, ctx.session)
    if args.include_archived:
        folders = folders + await service.list_archived_folders(ctx.user.id, ctx.session)
    return {
        "folders": [
            {
                "id": f.id,
                "name": f.name,
                "subject": f.subject,
                "description": f.description,
                "is_archived": f.is_archived,
                "test_count": getattr(f, "test_count", None),
                "flashcard_count": getattr(f, "flashcard_count", None),
            }
            for f in folders
        ]
    }


# ---------------------------------------------------------------- notes

class FolderArgs(ToolArgs):
    folder_id: int = Field(description="Folder id from list_folders.")


async def list_folder_notes(ctx: McpContext, args: FolderArgs) -> dict[str, Any]:
    await owned_folder(ctx, args.folder_id)
    rows = (
        await ctx.session.execute(
            select(
                FolderFile.id,
                FolderFile.file_name,
                FolderFile.file_type,
                FolderFile.upload_status,
                func.length(FolderFile.content),
                func.substr(FolderFile.content, 1, NOTE_PREVIEW_CHARS),
            )
            .where(FolderFile.folder_id == args.folder_id)
            .order_by(FolderFile.uploaded_at)
        )
    ).all()
    return {
        "notes": [
            {
                "note_id": note_id,
                "file_name": name,
                "file_type": file_type,
                "status": status or "ready",
                "total_chars": length or 0,
                "preview": preview or "",
            }
            for note_id, name, file_type, status, length, preview in rows
        ]
    }


class ReadNoteArgs(ToolArgs):
    note_id: int = Field(description="note_id from list_folder_notes.")
    offset: int = Field(default=0, ge=0, description="Character offset to start reading from.")
    max_chars: int = Field(default=NOTE_PAGE_DEFAULT, ge=1, le=NOTE_PAGE_MAX)


async def read_note(ctx: McpContext, args: ReadNoteArgs) -> dict[str, Any]:
    file = await ctx.session.scalar(
        select(FolderFile)
        .join(Folder, Folder.id == FolderFile.folder_id)
        .where(FolderFile.id == args.note_id, Folder.user_id == ctx.user.id)
    )
    if file is None:
        raise ResourceNotFoundException("Note")
    content = file.content or ""
    end = min(len(content), args.offset + args.max_chars)
    return {
        "note_id": file.id,
        "folder_id": file.folder_id,
        "file_name": file.file_name,
        "total_chars": len(content),
        "offset": args.offset,
        "content": content[args.offset:end],
        "next_offset": end if end < len(content) else None,
    }


# ---------------------------------------------------------------- tests

async def list_tests(ctx: McpContext, args: FolderArgs) -> dict[str, Any]:
    tests = await TestService().list_tests(args.folder_id, ctx.user.id, ctx.session)
    return {"tests": [dump(t) for t in tests]}


class TestArgs(ToolArgs):
    test_id: int = Field(description="Test id from list_tests.")


def _test_mode(test: Any) -> str:
    if test.is_coding_mode:
        return "coding"
    return "stem" if test.is_math_mode else "general"


async def get_test(ctx: McpContext, args: TestArgs) -> dict[str, Any]:
    test = await TestRepository(ctx.session).get_owned(args.test_id, ctx.user.id)
    if test is None:
        raise ResourceNotFoundException("Test")
    questions = await TestService().get_questions_for_editing(args.test_id, ctx.user.id, ctx.session)
    return {
        "id": test.id,
        "folder_id": test.folder_id,
        "title": test.title,
        "description": test.description,
        "test_type": test.test_type,
        "mode": _test_mode(test),
        "coding_language": test.coding_language,
        "generation_status": test.generation_status,
        "questions": [dump(q) for q in questions],
    }


# ---------------------------------------------------------------- drafts + results

# Scratch-pad ink (stroke JSON) is large and useless to a model; the OCR
# transcript of the same drawing stays in the result.
_INK_FIELDS = ("work_strokes",)


def _without_ink(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k not in _INK_FIELDS}


class NoArgs(ToolArgs):
    pass


async def list_drafts(ctx: McpContext, args: NoArgs) -> dict[str, Any]:
    drafts = await GradingService().get_resumable_tests(ctx.user.id, ctx.session)
    return {"drafts": [dump(d) for d in drafts]}


async def get_test_draft(ctx: McpContext, args: TestArgs) -> dict[str, Any]:
    draft = await GradingService().get_draft_attempt(args.test_id, ctx.user.id, ctx.session)
    payload = dump(draft)
    payload["answers"] = [_without_ink(a) for a in payload["answers"]]
    return payload


async def list_test_attempts(ctx: McpContext, args: TestArgs) -> dict[str, Any]:
    attempts = await GradingService().list_attempts(args.test_id, ctx.user.id, ctx.session)
    return {"attempts": [dump(a) for a in attempts]}


class AttemptArgs(ToolArgs):
    attempt_id: int = Field(description="Attempt id from list_test_attempts.")


async def get_attempt_result(ctx: McpContext, args: AttemptArgs) -> dict[str, Any]:
    detail = await GradingService().get_attempt_detail(args.attempt_id, ctx.user.id, ctx.session)
    payload = dump(detail)
    payload["answers"] = [_without_ink(a) for a in payload["answers"]]
    return payload


# ---------------------------------------------------------------- flashcards

class ListFlashcardsArgs(ToolArgs):
    folder_id: int = Field(description="Folder id from list_folders.")
    limit: int = Field(default=200, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


async def list_flashcards(ctx: McpContext, args: ListFlashcardsArgs) -> dict[str, Any]:
    cards = await FlashcardService().list_flashcards(
        args.folder_id, ctx.user.id, ctx.session, limit=args.limit, offset=args.offset
    )
    return {
        "flashcards": [
            {
                "id": c.id,
                "front": c.front,
                "back": c.back,
                "difficulty": c.difficulty,
                "attempt_count": c.attempt_count,
                "success_rate": c.success_rate,
            }
            for c in cards
        ]
    }


# ---------------------------------------------------------------- learning modules

class ListTracksArgs(ToolArgs):
    folder_id: int = Field(description="Folder id from list_folders.")
    include_archived: bool = Field(default=False, description="Also list archived tracks.")


async def list_learning_tracks(ctx: McpContext, args: ListTracksArgs) -> dict[str, Any]:
    await owned_folder(ctx, args.folder_id)
    stmt = (
        select(LearningTrack)
        .where(LearningTrack.folder_id == args.folder_id)
        .options(selectinload(LearningTrack.modules))
        .order_by(LearningTrack.created_at.desc())
    )
    if not args.include_archived:
        stmt = stmt.where(LearningTrack.is_archived.is_(False))
    tracks = (await ctx.session.scalars(stmt)).all()
    return {
        "tracks": [
            {
                "id": t.id,
                "format": t.format,
                "status": t.status,
                "is_archived": t.is_archived,
                "modules": [
                    {
                        "id": m.id,
                        "order_index": m.order_index,
                        "title": m.title,
                        "summary": m.summary,
                        "passed": m.passed,
                        "best_score": m.best_score,
                    }
                    for m in t.modules
                ],
            }
            for t in tracks
        ]
    }


class ModuleArgs(ToolArgs):
    module_id: int = Field(description="Module id from list_learning_tracks.")


def _parse_json_list(raw: Optional[str]) -> Optional[list[Any]]:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    return value if isinstance(value, list) else None


async def get_learning_module(ctx: McpContext, args: ModuleArgs) -> dict[str, Any]:
    module = await ctx.session.scalar(
        select(LearningModule)
        .join(LearningTrack, LearningTrack.id == LearningModule.track_id)
        .join(Folder, Folder.id == LearningTrack.folder_id)
        .where(LearningModule.id == args.module_id, Folder.user_id == ctx.user.id)
    )
    if module is None:
        raise ResourceNotFoundException("Learning module")
    return {
        "id": module.id,
        "track_id": module.track_id,
        "order_index": module.order_index,
        "title": module.title,
        "summary": module.summary,
        "lesson_markdown": module.lesson_content,
        "narration_script": module.tts_script,
        "video_url": module.video_url,
        "quiz": _parse_json_list(module.quiz_json),
        "passed": module.passed,
        "best_score": module.best_score,
    }


# ---------------------------------------------------------------- registry

TOOLS: dict[str, McpTool] = {
    tool.name: tool
    for tool in (
        McpTool(
            "list_folders",
            "List folders",
            "List the user's Nosey study folders. Every test, flashcard deck, note and "
            "learning track lives in a folder, so start here to find ids.",
            ListFoldersArgs,
            list_folders,
        ),
        McpTool(
            "list_folder_notes",
            "List notes in a folder",
            "List the notes the user uploaded to a folder (PDFs, docs, text), with size and "
            "a short preview. Read one in full with read_note.",
            FolderArgs,
            list_folder_notes,
        ),
        McpTool(
            "read_note",
            "Read a note",
            "Read the extracted text of one uploaded note. Long notes come back in pages: "
            "call again with offset=next_offset until next_offset is null.",
            ReadNoteArgs,
            read_note,
        ),
        McpTool(
            "list_tests",
            "List tests in a folder",
            "List the practice tests in a folder with question counts and best scores.",
            FolderArgs,
            list_tests,
        ),
        McpTool(
            "get_test",
            "Get a test",
            "Get one test with every question, its options, the correct answers, expected "
            "FRQ answers, and multi-part group setups.",
            TestArgs,
            get_test,
        ),
        McpTool(
            "list_drafts",
            "List unfinished tests",
            "List every test the user started and left unfinished, with how many questions "
            "they answered so far. Read one with get_test_draft.",
            NoArgs,
            list_drafts,
        ),
        McpTool(
            "get_test_draft",
            "Get a test draft",
            "Get the answers the user has typed so far on an unfinished test. Pair with "
            "get_test to see the questions they belong to.",
            TestArgs,
            get_test_draft,
        ),
        McpTool(
            "list_test_attempts",
            "List results for a test",
            "List every submitted attempt of a test, newest first, with score and date.",
            TestArgs,
            list_test_attempts,
        ),
        McpTool(
            "get_attempt_result",
            "Get an attempt's results",
            "Get one submitted attempt question by question: the user's answer, the correct "
            "answer, whether it was right, and the grader's feedback. Use it to find what the "
            "user gets wrong before building new practice.",
            AttemptArgs,
            get_attempt_result,
        ),
        McpTool(
            "list_flashcards",
            "List flashcards in a folder",
            "List a folder's flashcards with the user's review stats.",
            ListFlashcardsArgs,
            list_flashcards,
        ),
        McpTool(
            "list_learning_tracks",
            "List learning tracks in a folder",
            "List a folder's learning module tracks (article, podcast, video lecture) and "
            "their modules, with which ones the user has passed.",
            ListTracksArgs,
            list_learning_tracks,
        ),
        McpTool(
            "get_learning_module",
            "Get a learning module",
            "Get one learning module: lesson markdown, narration script, video URL and quiz "
            "with correct answers.",
            ModuleArgs,
            get_learning_module,
        ),
        *WRITE_TOOLS,
        *LEARNING_TOOLS,
    )
}

# Writes are capped per user on top of the per-token request limit on /mcp:
# one call can create a whole test, so 30 a minute is plenty for real use and
# keeps a runaway agent loop from flooding the library.
_WRITE_LIMITS = (parse_limit("30/minute"), parse_limit("600/day"))


def _format_validation_error(exc: ValidationError) -> str:
    problems = []
    for err in exc.errors():
        where = ".".join(str(part) for part in err.get("loc", ())) or "arguments"
        problems.append(f"{where}: {err.get('msg')}")
    return "Invalid arguments. " + "; ".join(problems)


async def call_tool(ctx: McpContext, name: str, arguments: Any) -> tuple[dict[str, Any], bool]:
    """Run a tool. Returns (payload, is_error). Unknown names raise KeyError."""
    tool = TOOLS[name]
    try:
        args = tool.args.model_validate(arguments or {})
    except ValidationError as exc:
        return {"error": _format_validation_error(exc)}, True
    user_id = ctx.user.id  # read now: a rollback below expires the user
    if not tool.read_only:
        for limit in _WRITE_LIMITS:
            if not limiter.limiter.hit(limit, "mcp-write", str(user_id)):
                return {"error": f"Too many changes in a short time (limit {limit}). Wait, then try again."}, True
    try:
        return await tool.handler(ctx, args), False
    except ResourceNotFoundException as exc:
        return {"error": str(exc) or "Not found."}, True
    except StudyAppException as exc:
        await ctx.session.rollback()
        return {"error": str(exc)}, True
    except HTTPException as exc:
        # Moderation (screen_user_input) refuses with an HTTPException. Over
        # MCP it becomes a tool error; the flag and any ban are already saved.
        await ctx.session.rollback()
        logger.info("MCP write %s refused for user %s: %s", name, user_id, exc.status_code)
        return {"error": str(exc.detail)}, True
