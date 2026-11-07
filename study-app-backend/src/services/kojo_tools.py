"""Kojo tools (GH #205): Kojo uses the Nosey MCP tools from general chat.

Text protocol, so it works on every provider: the prompt lists each tool and
Kojo replies with ``<tool>{"name": ..., "args": {...}}</tool>`` to call one.

Kinds:
- read: run immediately, the JSON result goes back into the next round.
- write / delete: never run here. They become a confirm card carrying an
  HMAC-signed token (user + conversation + tool + args, 10 min). The student
  confirms through POST /kojo/actions/confirm, which verifies and runs it.
- ui: open_action adds a deep-link button, ask_student shows a question card.
  Neither touches the DB.

Pure helpers (prompt block, tag filter, token signing, describe) live here so
kojo_service only wires the loop into the stream.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from pydantic import Field, ValidationError
from sqlalchemy import select

from src.config import settings
from src.models.folder_file import FolderFile
from src.models.study_plan import StudyPlan
from src.models.test import Test
from src.models.folder import Folder
from src.services.mcp_tool_base import McpContext, McpTool, ToolArgs, ToolInputError, owned_folder
from src.services.mcp_tools import TOOLS as MCP_TOOLS
from src.utils.logger import get_logger

logger = get_logger(__name__)

MAX_ROUNDS = 4
MAX_CALLS_PER_ROUND = 3
TOKEN_TTL_SECONDS = 600
_RESULT_CHARS = 6000

READ_TOOLS = (
    "list_folders", "list_folder_notes", "read_note", "list_tests", "get_test", "list_drafts",
    "list_test_attempts", "get_attempt_result", "list_flashcards", "list_study_plans",
    "get_study_plan", "list_learning_tracks", "get_learning_module",
)
WRITE_TOOLS = (
    "create_flashcards", "add_note", "create_folder", "rename_folder", "create_study_plan",
    "update_study_plan_items", "set_plan_item_done", "regrade_attempt", "edit_question",
    "edit_flashcard", "create_learning_track",
)
DELETE_TOOLS = ("delete_test", "delete_flashcards", "delete_note", "delete_study_plan")


# ---------------------------------------------------------------- Kojo-only tools

class NoArgs(ToolArgs):
    pass


class FolderIdArgs(ToolArgs):
    folder_id: int


class GenerateTestArgs(ToolArgs):
    folder_id: int
    title: str = Field(min_length=1, max_length=120)
    test_type: Literal["mixed", "MCQ_only", "FRQ_only"] = "mixed"
    count_mcq: int = Field(default=10, ge=0, le=30)
    count_frq: int = Field(default=5, ge=0, le=15)
    difficulty: Literal["easy", "medium", "hard", "mixed"] = "mixed"
    topic_focus: Optional[str] = Field(default=None, max_length=200, description="Topics to focus on, e.g. weak spots")


class GenerateFlashcardsArgs(ToolArgs):
    folder_id: int
    count: int = Field(default=20, ge=1, le=40)
    prompt: Optional[str] = Field(default=None, max_length=500, description="What the cards should cover")


class OpenActionArgs(ToolArgs):
    kind: Literal["review_due", "review_flashcards", "take_test", "view_result", "open_folder", "open_module", "dashboard"]
    label: str = Field(min_length=1, max_length=40)
    folder_id: Optional[int] = None
    test_id: Optional[int] = None
    attempt_id: Optional[int] = None
    module_id: Optional[int] = None


class AskOption(ToolArgs):
    label: str = Field(min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=140)


class AskQuestion(ToolArgs):
    question: str = Field(min_length=1, max_length=240)
    header: str = Field(default="", max_length=16, description="1-2 word tab label")
    options: list[AskOption] = Field(min_length=2, max_length=4)
    multi_select: bool = False


class AskStudentArgs(ToolArgs):
    questions: list[AskQuestion] = Field(min_length=1, max_length=4)


async def _weak_spots(ctx: McpContext, _args: NoArgs) -> dict[str, Any]:
    from src.services.folder_stats_service import FolderStatsService

    spots = await FolderStatsService().weak_spots(ctx.user.id, ctx.session)
    return {"weak_spots": [s.model_dump(mode="json", exclude_none=True) for s in spots]}


async def _folder_stats(ctx: McpContext, args: FolderIdArgs) -> dict[str, Any]:
    from src.services.folder_stats_service import FolderStatsService

    stats = await FolderStatsService().get_stats(args.folder_id, ctx.user.id, ctx.session)
    return stats.model_dump(mode="json", exclude_none=True)


async def _due_flashcards(ctx: McpContext, _args: NoArgs) -> dict[str, Any]:
    from src.services.flashcard_service import FlashcardService

    summary = await FlashcardService().get_due_summary(ctx.user.id, ctx.session)
    data = summary.model_dump(mode="json", exclude_none=True)
    data.pop("cards", None)  # per-card rows are noise for Kojo; counts per folder are enough
    return data


async def _usage_limits(ctx: McpContext, _args: NoArgs) -> dict[str, Any]:
    from src.services.quota_service import QuotaService, is_exempt

    statuses = await QuotaService().get_status(ctx.session, ctx.user)
    return {
        "unlimited": is_exempt(ctx.user) or not settings.usage_limits_enabled,
        "window_hours": settings.usage_window_hours,
        "features": [
            {"feature": s.feature, "used": s.used, "limit": s.limit, "unit": s.unit,
             "resets_at": s.resets_at.isoformat() if s.resets_at else None}
            for s in statuses
        ],
    }


async def _generate_test(ctx: McpContext, args: GenerateTestArgs) -> dict[str, Any]:
    """Same pipeline as the Create Test page with the folder's saved files."""
    from sqlalchemy import func

    from src.repositories.test_repository import TestRepository
    from src.routes.tests import _extract_and_generate_background, _spawn_generation
    from src.services.quota_service import QuotaService
    from src.utils.provider_policy import resolve_request_provider

    folder = await owned_folder(ctx, args.folder_id)
    file_count = await ctx.session.scalar(
        select(func.count()).select_from(FolderFile).where(FolderFile.folder_id == folder.id)
    )
    if not file_count:
        raise ToolInputError("That folder has no uploaded notes to build a test from.")
    count_mcq = 0 if args.test_type == "FRQ_only" else args.count_mcq
    count_frq = 0 if args.test_type == "MCQ_only" else args.count_frq
    if count_mcq + count_frq == 0:
        raise ToolInputError("Ask for at least one question.")
    user_id, folder_id, avoid = ctx.user.id, folder.id, bool(getattr(folder, "avoid_repeat_questions", False))
    provider = resolve_request_provider(ctx.user, None)
    charge_id = await QuotaService().charge_test(ctx.session, ctx.user)
    test = await TestRepository(ctx.session).create(folder_id, args.title, args.test_type, None)
    test.generation_status = "generating"
    test.expected_question_count = count_mcq + count_frq
    await ctx.session.commit()
    _spawn_generation(
        _extract_and_generate_background(
            test_id=test.id, user_id=user_id, folder_id=folder_id, notes_paths=[],
            practice_test_path=None, use_folder_files=True, avoid_repeat=avoid,
            test_type=args.test_type, count_mcq=count_mcq, count_frq=count_frq,
            is_math_mode=False, difficulty=args.difficulty, topic_focus=args.topic_focus,
            is_coding_mode=False, coding_language=None, custom_instructions=None,
            provider=provider, enable_fallback=True, quota_charge_id=charge_id,
        )
    )
    return {"test_id": test.id, "title": args.title, "status": "generating", "url": f"/test/{test.id}"}


async def _generate_flashcards(ctx: McpContext, args: GenerateFlashcardsArgs) -> dict[str, Any]:
    from src.database import async_session_maker
    from src.services.flashcard_service import FlashcardService
    from src.services.quota_service import QuotaService
    from src.utils.provider_policy import resolve_request_provider
    from src.utils.usage_context import bind_usage

    await owned_folder(ctx, args.folder_id)
    provider = resolve_request_provider(ctx.user, None)
    count, charge_id = await QuotaService().charge_flashcards(ctx.session, ctx.user, args.count)
    bind_usage(ctx.user.id, "flashcard_generation")
    produced = 0
    try:
        cards = await FlashcardService().generate_from_prompt(
            args.folder_id, ctx.user.id, args.prompt or "", count, ctx.session, provider=provider,
        )
        produced = len(cards)
        return {"created": produced, "folder_id": args.folder_id, "url": f"/flashcards/{args.folder_id}/review"}
    finally:
        if charge_id is not None:
            try:
                async with async_session_maker() as quota_session:
                    await QuotaService().settle_charge(quota_session, charge_id, produced)
            except Exception:  # noqa: BLE001
                pass


async def _ui_only(_ctx: McpContext, _args: Any) -> dict[str, Any]:
    return {"ok": True}


KOJO_TOOLS: dict[str, McpTool] = {
    t.name: t
    for t in (
        McpTool("get_weak_spots", "Weak spots", "The student's weakest topics across all folders, weakest first.",
                NoArgs, _weak_spots),
        McpTool("get_folder_stats", "Folder stats", "Topic mastery, scores and activity for one folder.",
                FolderIdArgs, _folder_stats),
        McpTool("get_due_flashcards", "Due flashcards", "How many flashcards are due for review, per folder.",
                NoArgs, _due_flashcards),
        McpTool("get_usage_limits", "Usage limits", "How many tests, flashcards and Kojo uses the student has left.",
                NoArgs, _usage_limits),
        McpTool("generate_test", "Generate a test",
                "Generate a practice test from the folder's uploaded notes with Nosey's test generator. "
                "Use topic_focus to target weak spots. Do not write questions yourself.",
                GenerateTestArgs, _generate_test, read_only=False),
        McpTool("generate_flashcards", "Generate flashcards",
                "Generate flashcards from the folder's notes with Nosey's generator; prompt narrows the topic.",
                GenerateFlashcardsArgs, _generate_flashcards, read_only=False),
        McpTool("open_action", "Action button",
                "Add a button under your answer that takes the student somewhere in Nosey. "
                "Use it when a next step helps (due cards, a test to retake, a result to review).",
                OpenActionArgs, _ui_only),
        McpTool("ask_student", "Ask the student",
                "Show a question card with clickable options when you need the student to choose "
                "(e.g. which folder, how many questions, difficulty). Up to 4 questions. Ends your turn.",
                AskStudentArgs, _ui_only),
    )
}

_READ = set(READ_TOOLS) | {"get_weak_spots", "get_folder_stats", "get_due_flashcards", "get_usage_limits"}
_WRITE = set(WRITE_TOOLS) | {"generate_test", "generate_flashcards"}
_DELETE = set(DELETE_TOOLS)
_UI = {"open_action", "ask_student"}


def get_tool(name: str) -> Optional[McpTool]:
    if name in KOJO_TOOLS:
        return KOJO_TOOLS[name]
    if name in _READ or name in _WRITE or name in _DELETE:
        return MCP_TOOLS.get(name)
    return None


def kind_of(name: str) -> Optional[str]:
    if name in _READ:
        return "read"
    if name in _WRITE:
        return "write"
    if name in _DELETE:
        return "delete"
    if name in _UI:
        return "ui"
    return None


_ALL_NAMES = [*READ_TOOLS, "get_weak_spots", "get_folder_stats", "get_due_flashcards", "get_usage_limits",
              *WRITE_TOOLS, "generate_test", "generate_flashcards", *DELETE_TOOLS, "open_action", "ask_student"]
_missing = [n for n in _ALL_NAMES if get_tool(n) is None]
if _missing:  # a renamed MCP tool must fail loudly at import, not silently vanish from Kojo
    raise RuntimeError(f"Kojo tools missing from the MCP registry: {_missing}")


# ---------------------------------------------------------------- prompt block

def _strip_schema(node: Any) -> Any:
    if isinstance(node, dict):
        return {k: _strip_schema(v) for k, v in node.items() if k not in ("title",)}
    if isinstance(node, list):
        return [_strip_schema(v) for v in node]
    return node


def _type_text(node: dict[str, Any], defs: dict[str, Any], depth: int = 0) -> str:
    """Compact type for the prompt: int, str, "a"|"b", [ {front,back,topic?} ]."""
    if "$ref" in node:
        node = defs.get(node["$ref"].rsplit("/", 1)[-1], {})
    if "anyOf" in node:
        kinds = [k for k in node["anyOf"] if k.get("type") != "null"]
        return _type_text(kinds[0], defs, depth) if kinds else "any"
    if "enum" in node:
        return "|".join(json.dumps(v) for v in node["enum"])
    if "const" in node:
        return json.dumps(node["const"])
    kind = node.get("type")
    if kind == "array":
        return f"[{_type_text(node.get('items', {}), defs, depth + 1)}]"
    if kind == "object" or "properties" in node:
        if depth > 3:
            return "{...}"
        return "{" + _props_text(node, defs, depth + 1) + "}"
    return {"integer": "int", "string": "str", "boolean": "bool", "number": "num"}.get(kind, "any")


def _props_text(node: dict[str, Any], defs: dict[str, Any], depth: int = 0) -> str:
    required = set(node.get("required", []))
    parts = []
    for prop, sub in (node.get("properties") or {}).items():
        if prop == "confirm":
            continue  # destructive tools: the confirm card supplies it
        text = _type_text(sub, defs, depth)
        if "{}" in text and sub.get("description"):
            text += f" ({sub['description']})"  # untyped dicts: the description is the schema
        parts.append(f"{prop}{'' if prop in required else '?'}:{text}")
    return ",".join(parts)


def _schema_text(tool: McpTool) -> str:
    schema = tool.args.model_json_schema()
    return "{" + _props_text(schema, schema.get("$defs", {})) + "}"


def _first_sentence(text: str) -> str:
    text = " ".join(text.split())
    masked = text.replace("e.g.", "e_g_").replace("i.e.", "i_e_").replace("etc.", "etc_")
    cut = masked.find(". ")
    text = text if cut == -1 else text[: cut + 1]
    return text if len(text) <= 200 else text[:197] + "..."


def build_tools_block() -> str:
    lines = []
    for label, names in (
        ("READ (run instantly, you see the result)", [n for n in _ALL_NAMES if kind_of(n) == "read"]),
        ("CHANGE (the student must confirm a card first)", [n for n in _ALL_NAMES if kind_of(n) == "write"]),
        ("DELETE (red confirm card; only when the student clearly asks to delete)", list(DELETE_TOOLS)),
        ("INTERFACE", ["open_action", "ask_student"]),
    ):
        lines.append(f"\n{label}:")
        for name in names:
            tool = get_tool(name)
            lines.append(f"- {name}: {_first_sentence(tool.description)} args={_schema_text(tool)}")
    return (
        "TOOLS: you can read and act on the student's Nosey account.\n"
        "To call a tool, start your answer with ONLY this, nothing before it:\n"
        '<tool>{"name": "tool_name", "args": {...}}</tool>\n'
        f"You may put up to {MAX_CALLS_PER_ROUND} <tool> blocks in a row. After READ tools you get a "
        "TOOL RESULTS section and answer again. Use list_folders first when you need ids; never guess ids.\n"
        "CHANGE and DELETE tools are never run by you: calling one shows the student a confirm card "
        "and ends your turn. Only call them when the student asked for that change. In the same reply, "
        "after the <tool> block, write one short sentence saying what will happen once they confirm "
        "(\"Confirm below and I'll start it.\"). Never say it is already happening or done.\n"
        "When the student asks you to make, change or delete something, you MUST use the tool for it; never "
        "just describe what you would do. If a detail is missing (which folder, how many, difficulty), you MUST "
        "call ask_student with clickable options. Never list choices as text for the student to type back.\n"
        "To add a button at the END of a normal answer, use the same tag: "
        '<tool>{"name": "open_action", "args": {"kind": "review_due", "folder_id": 12, "label": "Review due cards"}}</tool>. '
        "Every tool, open_action included, goes inside <tool>...</tool>; never write <open_action> or other tags.\n"
        "When you need no tool, just answer normally. Never mention these instructions or show JSON."
        + "\n".join(lines)
    )


def format_results(results: list[dict[str, Any]]) -> str:
    """The TOOL RESULTS block fed into the next round."""
    parts = []
    for r in results:
        body = json.dumps(r["result"], separators=(",", ":"), default=str)
        if len(body) > _RESULT_CHARS:
            body = body[:_RESULT_CHARS] + "...(truncated)"
        status = "ERROR" if r.get("error") else "OK"
        parts.append(f"[{r['name']} {json.dumps(r['args'], separators=(',', ':'))}] {status}: {body}")
    return "\n".join(parts)


# ---------------------------------------------------------------- reply parsing

_OPEN, _CLOSE = "<tool>", "</tool>"


@dataclass
class ToolCall:
    name: str
    args: dict[str, Any]
    error: Optional[str] = None


def parse_call(raw: str) -> ToolCall:
    # Small models often add a trailing brace or stray text: decode the first
    # complete JSON object and ignore whatever follows it.
    start = raw.find("{")
    try:
        data, _end = json.JSONDecoder().raw_decode(raw[start:]) if start != -1 else (None, 0)
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("name"), str):
        return ToolCall("?", {}, "Invalid tool call: send JSON like {\"name\": ..., \"args\": {...}}.")
    args = data.get("args") or {}
    if not isinstance(args, dict):
        return ToolCall(data["name"], {}, "args must be a JSON object.")
    if kind_of(data["name"]) is None:
        return ToolCall(data["name"], args, f"Unknown tool {data['name']!r}.")
    return ToolCall(data["name"], args)


class ToolTagFilter:
    """Streams answer text with <tool>...</tool> blocks cut out.

    ``leading`` is True once the reply starts with a tool block (after
    whitespace): that round is a tool round and its text never streams except
    what follows the blocks, which is kept in ``trailing`` for write/ask cards.
    """

    def __init__(self) -> None:
        self.buf = ""
        self.calls: list[str] = []
        self.started = False  # decided whether the reply leads with a tool
        self.leading = False
        self.trailing = ""

    def feed(self, text: str) -> str:
        self.buf += text
        out = []
        while True:
            if not self.started:
                stripped = self.buf.lstrip()
                if not stripped:
                    return ""
                if _OPEN.startswith(stripped[: len(_OPEN)]) and len(stripped) < len(_OPEN):
                    return ""  # could still become "<tool>"
                self.started = True
                self.leading = stripped.startswith(_OPEN)
                if self.leading:
                    self.buf = stripped
            idx = self.buf.find(_OPEN)
            if idx == -1:
                # Hold a tail that could be the start of "<tool>".
                hold = 0
                for k in range(min(len(_OPEN) - 1, len(self.buf)), 0, -1):
                    if _OPEN.startswith(self.buf[-k:]):
                        hold = k
                        break
                emit, self.buf = self.buf[: len(self.buf) - hold], self.buf[len(self.buf) - hold:]
                out.append(emit)
                break
            end = self.buf.find(_CLOSE, idx)
            if end == -1:
                out.append(self.buf[:idx])
                self.buf = self.buf[idx:]
                break
            out.append(self.buf[:idx])
            self.calls.append(self.buf[idx + len(_OPEN):end])
            self.buf = self.buf[end + len(_CLOSE):]
        text_out = "".join(out)
        if self.leading:
            self.trailing += text_out
            return ""
        return text_out

    def flush(self) -> str:
        rest = self.buf
        self.buf = ""
        if not self.started:
            self.started = True
        if rest.startswith(_OPEN):
            # Unclosed tool block at the end: try to use it anyway.
            self.calls.append(rest[len(_OPEN):])
            rest = ""
        if self.leading:
            self.trailing += rest
            return ""
        return rest


# ---------------------------------------------------------------- confirm tokens

def _key() -> bytes:
    return hashlib.sha256(f"kojo-tools:{settings.jwt_secret}".encode()).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign_action(user_id: int, conversation_id: int, name: str, args: dict[str, Any]) -> str:
    payload = json.dumps(
        {"u": user_id, "c": conversation_id, "n": name, "a": args, "e": int(time.time()) + TOKEN_TTL_SECONDS},
        separators=(",", ":"), sort_keys=True,
    ).encode()
    sig = hmac.new(_key(), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(sig)}"


def verify_action(token: str, user_id: int) -> Optional[dict[str, Any]]:
    """The signed payload, or None when tampered, expired or not this user's."""
    try:
        body, sig = token.split(".", 1)
        payload = _unb64(body)
        if not hmac.compare_digest(hmac.new(_key(), payload, hashlib.sha256).digest(), _unb64(sig)):
            return None
        data = json.loads(payload)
    except Exception:  # noqa: BLE001
        return None
    if data.get("u") != user_id or int(data.get("e", 0)) < time.time():
        return None
    return data


# ---------------------------------------------------------------- cards

def validate_args(name: str, args: dict[str, Any]) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    tool = get_tool(name)
    if tool.destructive:
        args = {**args, "confirm": True}
    try:
        return tool.args.model_validate(args).model_dump(mode="json", exclude_none=True), None
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in e.get('loc', ())) or 'args'}: {e.get('msg')}" for e in exc.errors()
        )
        return None, f"Invalid arguments. {problems}"


async def _name_of(ctx: McpContext, model, row_id: Optional[int], attr: str, owner_join=None) -> Optional[str]:
    if row_id is None:
        return None
    try:
        query = select(getattr(model, attr)).where(model.id == row_id)
        if owner_join is not None:
            query = owner_join(query)
        return await ctx.session.scalar(query)
    except Exception:  # noqa: BLE001
        return None


async def describe(ctx: McpContext, name: str, args: dict[str, Any]) -> tuple[str, list[str]]:
    """(title, detail lines) for a confirm card, in plain words."""
    uid = ctx.user.id

    def by_folder(model):
        return lambda q: q.join(Folder, Folder.id == model.folder_id).where(Folder.user_id == uid)

    folder = await _name_of(ctx, Folder, args.get("folder_id"), "name", lambda q: q.where(Folder.user_id == uid))
    where = f" in {folder}" if folder else ""
    if name == "generate_test":
        bits = []
        if args.get("test_type") != "FRQ_only":
            bits.append(f"{args.get('count_mcq', 10)} multiple choice")
        if args.get("test_type") != "MCQ_only":
            bits.append(f"{args.get('count_frq', 5)} written")
        lines = [", ".join(bits), f"Difficulty: {args.get('difficulty', 'mixed')}"]
        if args.get("topic_focus"):
            lines.append(f"Focus: {args['topic_focus']}")
        return f"Generate test \"{args.get('title')}\"{where}", lines
    if name == "generate_flashcards":
        lines = [f"Topic: {args['prompt']}"] if args.get("prompt") else []
        return f"Generate {args.get('count', 20)} flashcards{where}", lines
    if name == "create_flashcards":
        cards = args.get("cards") or []
        preview = [f"{c.get('front', '')[:60]}" for c in cards[:3] if isinstance(c, dict)]
        return f"Add {len(cards)} flashcards{where}", preview
    if name == "add_note":
        return f"Save note \"{args.get('title') or 'Kojo note'}\"{where}", [str(args.get("content", ""))[:140]]
    if name == "create_folder":
        return f"Create folder \"{args.get('name')}\"", []
    if name == "rename_folder":
        return f"Update folder{(' ' + folder) if folder else ''}", [f"Name: {args['name']}"] if args.get("name") else []
    if name == "create_study_plan":
        items = args.get("items") or []
        lines = [f"{len(items)} items"] + ([f"Exam: {args['exam_date']}"] if args.get("exam_date") else [])
        return f"Create study plan \"{args.get('title')}\"", lines
    if name == "update_study_plan_items":
        plan = await _name_of(ctx, StudyPlan, args.get("plan_id"), "title", lambda q: q.where(StudyPlan.user_id == uid))
        return f"Update items in \"{plan or 'study plan'}\"", [f"{len(args.get('items') or [])} items"]
    if name == "set_plan_item_done":
        return ("Mark plan item done" if args.get("done") else "Mark plan item not done"), []
    if name == "regrade_attempt":
        return "Regrade test answers", [f"{len(args.get('grades') or [])} answers"]
    if name == "edit_question":
        return "Edit a test question", [f"{k}: {str(v)[:80]}" for k, v in args.items() if k != "question_id"][:3]
    if name == "edit_flashcard":
        return "Edit a flashcard", [f"{k}: {str(v)[:80]}" for k, v in args.items() if k != "flashcard_id"][:3]
    if name == "create_learning_track":
        return f"Create a learning track{where}", [f"{len(args.get('modules') or [])} modules"]
    if name == "delete_test":
        title = await _name_of(ctx, Test, args.get("test_id"), "title", by_folder(Test))
        return f"Delete test \"{title or args.get('test_id')}\"?", ["Its results are deleted too. This can't be undone."]
    if name == "delete_note":
        file_name = await _name_of(ctx, FolderFile, args.get("note_id"), "file_name", by_folder(FolderFile))
        return f"Delete note \"{file_name or args.get('note_id')}\"?", ["This can't be undone."]
    if name == "delete_study_plan":
        plan = await _name_of(ctx, StudyPlan, args.get("plan_id"), "title", lambda q: q.where(StudyPlan.user_id == uid))
        return f"Delete study plan \"{plan or args.get('plan_id')}\"?", ["This can't be undone."]
    if name == "delete_flashcards":
        return f"Delete {len(args.get('flashcard_ids') or [])} flashcards?", ["This can't be undone."]
    return get_tool(name).title, []


_ACTION_ROUTES = {
    "review_due": ("folder_id",),
    "review_flashcards": ("folder_id",),
    "take_test": ("test_id",),
    "view_result": ("attempt_id",),
    "open_folder": ("folder_id",),
    "open_module": ("folder_id", "module_id"),
    "dashboard": (),
}


def action_link(args: dict[str, Any]) -> Optional[dict[str, str]]:
    """A validated in-app link for open_action, or None when ids are missing."""
    kind = args.get("kind")
    needed = _ACTION_ROUTES.get(kind)
    if needed is None or any(not isinstance(args.get(k), int) for k in needed):
        return None
    f, t, a, m = args.get("folder_id"), args.get("test_id"), args.get("attempt_id"), args.get("module_id")
    to = {
        "review_due": f"/flashcards/{f}/review?due=1",
        "review_flashcards": f"/flashcards/{f}/review",
        "take_test": f"/test/{t}",
        "view_result": f"/results/{a}",
        "open_folder": f"/folders/{f}",
        "open_module": f"/flashcards/{f}/modules/{m}",
        "dashboard": "/dashboard",
    }[kind]
    return {"label": str(args.get("label", "Open"))[:40], "to": to}


def step_label(name: str, args: dict[str, Any]) -> str:
    """Short chip label for a tool step ("Read note", "Checked weak spots")."""
    labels = {
        "list_folders": "Looked at your folders",
        "list_folder_notes": "Listed notes",
        "read_note": "Read a note",
        "list_tests": "Listed tests",
        "get_test": "Opened a test",
        "list_drafts": "Checked unfinished tests",
        "list_test_attempts": "Listed results",
        "get_attempt_result": "Reviewed a result",
        "list_flashcards": "Looked at flashcards",
        "list_study_plans": "Checked study plans",
        "get_study_plan": "Opened a study plan",
        "list_learning_tracks": "Listed learning tracks",
        "get_learning_module": "Opened a module",
        "get_weak_spots": "Checked weak spots",
        "get_folder_stats": "Checked folder stats",
        "get_due_flashcards": "Checked due flashcards",
        "get_usage_limits": "Checked usage limits",
    }
    return labels.get(name) or (get_tool(name).title if get_tool(name) else name)


def result_summary(name: str, result: dict[str, Any]) -> str:
    """One line for the expandable chip detail: what the tool returned."""
    if "error" in result:
        return f"Error: {result['error']}"
    for key in ("title", "name", "file_name"):
        if isinstance(result.get(key), str):
            return result[key][:120]
    for key, value in result.items():
        if isinstance(value, list):
            names = [
                str(v.get("title") or v.get("name") or v.get("file_name") or v.get("topic") or v.get("folder_name") or "")
                for v in value[:6] if isinstance(v, dict)
            ]
            names = [n for n in names if n]
            more = f" (+{len(value) - 6} more)" if len(value) > 6 else ""
            return f"{len(value)} {key.replace('_', ' ')}" + (f": {', '.join(names)}{more}" if names else "")
    return ", ".join(f"{k}: {v}" for k, v in list(result.items())[:4] if not isinstance(v, (dict, list)))[:160]


@dataclass
class LoopState:
    """Per-turn tool state (lives only for one request)."""
    results: list[dict[str, Any]] = field(default_factory=list)
    buttons: list[dict[str, str]] = field(default_factory=list)
    card: Optional[dict[str, Any]] = None  # confirm or question card that ends the turn


# ---------------------------------------------------------------- running

async def run_tool(ctx: McpContext, name: str, args: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Run one tool. Returns (payload, is_error). MCP tools go through
    mcp_tools.call_tool (validation, write rate limits, moderation refusals);
    Kojo-only tools get the same error mapping here."""
    from fastapi import HTTPException

    from src.services.mcp_tools import call_tool
    from src.utils.exceptions import ResourceNotFoundException, StudyAppException

    if name in MCP_TOOLS:
        return await call_tool(ctx, name, args)
    tool = KOJO_TOOLS[name]
    try:
        parsed = tool.args.model_validate(args or {})
    except ValidationError as exc:
        return {"error": "Invalid arguments. " + "; ".join(str(e.get("msg")) for e in exc.errors())}, True
    try:
        return await tool.handler(ctx, parsed), False
    except ResourceNotFoundException as exc:
        return {"error": str(exc) or "Not found."}, True
    except StudyAppException as exc:
        await ctx.session.rollback()
        return {"error": str(exc)}, True
    except HTTPException as exc:  # quota (429) and moderation refusals
        await ctx.session.rollback()
        return {"error": str(exc.detail)}, True


async def run_isolated(user, name: str, args: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Run a READ tool on its own session, so a tool error's rollback can never
    undo the chat turn's pending rows on the request session."""
    from src.database import async_session_maker

    async with async_session_maker() as session:
        try:
            return await run_tool(McpContext(user=user, session=session), name, args)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Kojo tool %s crashed: %s", name, exc)
            return {"error": "That tool failed. Try a different approach."}, True


_STRAY_TAG = re.compile(r"<([a-z_]+)>\s*(\{.*?\})\s*</\1>", re.S)


def strip_stray_tags(text: str) -> tuple[str, list[ToolCall]]:
    """Small models sometimes write <open_action>{...}</open_action> instead
    of a <tool> block. Cut those out of the saved answer and recover the call."""
    calls: list[ToolCall] = []

    def _cut(match: re.Match) -> str:
        if kind_of(match.group(1)) is None:
            return match.group(0)
        try:
            args = json.loads(match.group(2))
        except json.JSONDecodeError:
            return ""
        if isinstance(args, dict):
            calls.append(ToolCall(match.group(1), args))
        return ""

    return _STRAY_TAG.sub(_cut, text).rstrip(), calls
