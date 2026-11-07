"""MCP tools for Kojo pattern lectures (services/lecture_service.py).

The connected app writes the lecture; these tools validate it and save it. No Nosey
LLM call. Lectures are shared by every user, so writing is admin-only; reading the
catalog and the request queue is open to beta accounts.
"""
from __future__ import annotations

import json
from typing import Any, Literal, Optional

from pydantic import Field
from sqlalchemy import select

from src.config import settings
from src.models.lc_sync import LCLecture, LCLectureRequest
from src.services import lc_catalog
from src.services.lecture_service import (
    CATALOG,
    CATALOG_BY_SLUG,
    SLUG_RE,
    lecture_problems,
    normalize_lecture,
    slugify,
)
from src.services.mcp_tool_base import McpContext, McpTool, ToolArgs, ToolInputError
from src.services.mcp_write_tools import screen
from src.utils.provider_policy import user_can_override_provider

Ink = Literal["ink", "red", "blue", "green"]

BOARD_RULES = (
    "Ink board: a 100 x 60 whiteboard, x right, y down. Each frame ADDS ink (earlier frames stay) unless "
    "clear=true wipes it first. strokes: points is a flat list [x1, y1, x2, y2, ...] drawn as straight segments "
    "(a box is 5 points ending where it started). labels: short text at x, y (the text baseline start; about 2 "
    "units wide per character, 4.4 tall). Draw arrays as a row of boxes, grids as row and column lines, mark the "
    "current cell with a circle (about 12 points, radius 3 to 4). Keep notes like `sum = 3` in a column at x 62 "
    "to 98; to UPDATE a value, write the new label at the SAME x, y and the old one is erased. Never write over "
    "other text and draw nothing decorative. Up to 7 frames, 30 strokes and 16 labels each."
)


def _require_beta(ctx: McpContext) -> None:
    if not user_can_override_provider(ctx.user):
        raise ToolInputError("KojoCode lectures are a beta feature this account cannot use yet.")


def _require_admin(ctx: McpContext) -> None:
    if not getattr(ctx.user, "is_admin", False):
        raise ToolInputError("Only Nosey admins can publish lectures: they are shared with every user.")


class StrokeIn(ToolArgs):
    points: list[float] = Field(min_length=4, max_length=48)
    color: Ink = "ink"


class LabelIn(ToolArgs):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=60)
    text: str = Field(min_length=1, max_length=24)
    color: Ink = "ink"


class FrameIn(ToolArgs):
    say: str = Field(min_length=1, max_length=400, description="1 to 2 spoken sentences for this step.")
    clear: bool = Field(default=False, description="Wipe the board before drawing this frame.")
    strokes: list[StrokeIn] = Field(default_factory=list, max_length=30)
    labels: list[LabelIn] = Field(default_factory=list, max_length=16)


class SaidPoint(ToolArgs):
    say: str = Field(min_length=1, max_length=400, description="What Kojo says.")
    point: str = Field(min_length=1, max_length=120, description="The short on-screen bullet for it.")


class SignalIn(ToolArgs):
    signal: str = Field(min_length=1, max_length=120, description="A clue in a problem, e.g. 'sum of a subarray'.")
    example: str = Field(default="", max_length=120, description="A phrase from a real problem showing it.")
    say: str = Field(min_length=1, max_length=400)


class CodeLineIn(ToolArgs):
    line: str = Field(max_length=300, description="One Python line, indentation kept. May be blank.")
    say: str = Field(default="", max_length=400, description="What Kojo says while typing it (blank lines: empty).")


class LectureContent(ToolArgs):
    summary: str = Field(min_length=1, max_length=400, description="One or two sentences for the lecture card.")
    theory: list[SaidPoint] = Field(min_length=2, max_length=6, description="Chapter 1: the idea, step by step.")
    theory_frames: list[FrameIn] = Field(min_length=1, max_length=7,
                                         description="Ink sketch of the idea on a small example. " + BOARD_RULES)
    signals: list[SignalIn] = Field(min_length=2, max_length=5, description="Chapter 2: how to spot the pattern.")
    template: list[CodeLineIn] = Field(min_length=3, max_length=40,
                                       description="Chapter 3: a reusable Python template, typed line by line.")
    problem_intro: list[SaidPoint] = Field(min_length=1, max_length=4,
                                           description="Chapter 4 opener: what the worked problem asks and why this pattern fits.")
    frames: list[FrameIn] = Field(min_length=1, max_length=7, description="Ink trace of the worked problem. " + BOARD_RULES)
    code: list[CodeLineIn] = Field(min_length=3, max_length=80,
                                   description="The worked problem's solution as `class Solution:` code, line by line.")
    time_complexity: str = Field(min_length=1, max_length=40)
    space_complexity: str = Field(min_length=1, max_length=40)
    complexity_say: str = Field(min_length=1, max_length=400)


def _texts(content: LectureContent) -> list[str]:
    out = [content.summary, content.complexity_say]
    out += [t for p in content.theory + content.problem_intro for t in (p.say, p.point)]
    out += [t for s in content.signals for t in (s.signal, s.example, s.say)]
    out += [t for c in content.template + content.code for t in (c.line, c.say)]
    out += [f.say for f in content.theory_frames + content.frames]
    out += [l.text for f in content.theory_frames + content.frames for l in f.labels]
    return out


def _lecture_url(slug: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}/leetcode?lecture={slug}"


# ---------------------------------------------------------------- read tools

class ListCatalogArgs(ToolArgs):
    missing_only: bool = Field(default=False, description="Only lectures that are not written yet.")


async def list_lecture_catalog(ctx: McpContext, args: ListCatalogArgs) -> dict[str, Any]:
    _require_beta(ctx)
    rows = {r.slug: r for r in (await ctx.session.execute(select(LCLecture))).scalars().all()}
    items = []
    for c in CATALOG:
        done = c.slug in rows
        if args.missing_only and done:
            continue
        p = lc_catalog.get(c.problem_slug)
        items.append({"slug": c.slug, "title": c.title, "category": c.category, "written": done,
                      "worked_problem": {"slug": c.problem_slug, "title": p.title if p else c.problem_slug}})
    community = [{"slug": r.slug, "title": r.title, "category": r.category, "written": True,
                  "worked_problem": {"slug": r.problem_slug}}
                 for r in rows.values() if r.slug not in CATALOG_BY_SLUG]
    if not args.missing_only:
        items += community
    return {"lectures": items, "how_to_write": "Call create_lecture with the slug. See its schema for each chapter."}


class GetLectureArgs(ToolArgs):
    slug: str = Field(min_length=2, max_length=120)


async def get_lecture(ctx: McpContext, args: GetLectureArgs) -> dict[str, Any]:
    _require_beta(ctx)
    row = (await ctx.session.execute(select(LCLecture).where(LCLecture.slug == args.slug))).scalar_one_or_none()
    if row is None:
        raise ToolInputError(f"no lecture {args.slug!r} yet. list_lecture_catalog shows what exists.")
    return {"slug": row.slug, "title": row.title, "category": row.category, "worked_problem": row.problem_slug,
            "source": row.source, "lecture": json.loads(row.lecture_json), "url": _lecture_url(row.slug)}


class ListRequestsArgs(ToolArgs):
    status: Literal["pending", "done", "rejected", "all"] = "pending"


async def list_lecture_requests(ctx: McpContext, args: ListRequestsArgs) -> dict[str, Any]:
    _require_beta(ctx)
    q = select(LCLectureRequest).order_by(LCLectureRequest.created_at)
    if args.status != "all":
        q = q.where(LCLectureRequest.status == args.status)
    if not getattr(ctx.user, "is_admin", False):
        q = q.where(LCLectureRequest.user_id == ctx.user.id)
    rows = (await ctx.session.execute(q.limit(200))).scalars().all()
    return {"requests": [{"request_id": r.id, "topic": r.topic, "category": r.category, "status": r.status,
                          "lecture_slug": r.lecture_slug} for r in rows]}


# ---------------------------------------------------------------- write tools (admin)

class CreateLectureArgs(LectureContent):
    slug: Optional[str] = Field(default=None, max_length=120,
                                description="A catalog slug from list_lecture_catalog. Leave empty for a new "
                                            "community topic (then title, category and problem_slug are required).")
    title: Optional[str] = Field(default=None, max_length=160, description="Defaults to the catalog title.")
    category: Optional[str] = Field(default=None, max_length=60, description="KojoCode topic id for a new topic.")
    problem_slug: Optional[str] = Field(default=None, max_length=200,
                                        description="Built-in KojoCode problem worked in chapter 4 (new topics).")
    request_id: Optional[int] = Field(default=None, description="The request this fulfills (marks it done).")


async def _save(ctx: McpContext, row: LCLecture, content: LectureContent, title: str) -> dict[str, Any]:
    await screen(ctx, title, *_texts(content))
    lecture = normalize_lecture({**content.model_dump(), "title": title})  # args may carry title=None
    issues = lecture_problems(lecture)
    if issues:
        raise ToolInputError("lecture is incomplete after cleanup: " + "; ".join(issues))
    row.title, row.summary, row.lecture_json = title, lecture["summary"], json.dumps(lecture)
    return lecture


async def create_lecture(ctx: McpContext, args: CreateLectureArgs) -> dict[str, Any]:
    _require_beta(ctx)
    _require_admin(ctx)
    if args.slug and args.slug in CATALOG_BY_SLUG:
        c = CATALOG_BY_SLUG[args.slug]
        slug, category, problem, source = c.slug, c.category, c.problem_slug, "curated"
        title = (args.title or c.title).strip()
    else:
        if not (args.title and args.category and args.problem_slug):
            raise ToolInputError("a new topic needs title, category and problem_slug (or use a catalog slug).")
        title, category, problem, source = args.title.strip(), args.category.strip(), args.problem_slug, "community"
        slug = args.slug or slugify(title)
        if not SLUG_RE.match(slug):
            raise ToolInputError("slug must be lowercase letters, digits and dashes.")
    if lc_catalog.get(problem) is None:
        raise ToolInputError(f"problem_slug {problem!r} is not a built-in KojoCode problem (list_leetcode_problems).")
    if (await ctx.session.execute(select(LCLecture.id).where(LCLecture.slug == slug))).first():
        raise ToolInputError(f"lecture {slug!r} already exists; use edit_lecture to change it.")
    row = LCLecture(slug=slug, category=category, problem_slug=problem, source=source, author_id=ctx.user.id)
    await _save(ctx, row, args, title)
    ctx.session.add(row)
    if args.request_id is not None:
        req = await ctx.session.get(LCLectureRequest, args.request_id)
        if req is None:
            raise ToolInputError(f"no request {args.request_id}.")
        req.status, req.lecture_slug = "done", slug
    await ctx.session.commit()
    return {"slug": slug, "title": title, "url": _lecture_url(slug)}


class EditLectureArgs(LectureContent):
    slug: str = Field(min_length=2, max_length=120)
    title: Optional[str] = Field(default=None, max_length=160)


async def edit_lecture(ctx: McpContext, args: EditLectureArgs) -> dict[str, Any]:
    """Replaces the whole lecture content (narration recordings re-record on next play)."""
    _require_beta(ctx)
    _require_admin(ctx)
    row = (await ctx.session.execute(select(LCLecture).where(LCLecture.slug == args.slug))).scalar_one_or_none()
    if row is None:
        raise ToolInputError(f"no lecture {args.slug!r}.")
    await _save(ctx, row, args, (args.title or row.title).strip())
    await ctx.session.commit()
    return {"slug": row.slug, "title": row.title, "url": _lecture_url(row.slug)}


class RejectRequestArgs(ToolArgs):
    request_id: int


async def reject_lecture_request(ctx: McpContext, args: RejectRequestArgs) -> dict[str, Any]:
    _require_beta(ctx)
    _require_admin(ctx)
    req = await ctx.session.get(LCLectureRequest, args.request_id)
    if req is None:
        raise ToolInputError(f"no request {args.request_id}.")
    req.status = "rejected"
    await ctx.session.commit()
    return {"request_id": req.id, "status": req.status}


LECTURE_TOOLS: tuple[McpTool, ...] = (
    McpTool("list_lecture_catalog", "List Kojo lectures",
            "KojoCode pattern lectures (prefix sum, union find, Dijkstra, heaps...): which exist and which are "
            "still unwritten, each with the catalog problem it works through.", ListCatalogArgs, list_lecture_catalog),
    McpTool("get_lecture", "Get a Kojo lecture", "One lecture's full content.", GetLectureArgs, get_lecture),
    McpTool("list_lecture_requests", "List lecture requests",
            "Topics users asked Kojo to teach. Fulfill one with create_lecture(request_id=...).",
            ListRequestsArgs, list_lecture_requests),
    McpTool("create_lecture", "Write a Kojo lecture",
            "Admin only. Write a pattern lecture played as a Kojo video for every user, in four chapters: theory "
            "(with an ink sketch), how to spot the pattern, a Python template, and a worked built-in problem (ink "
            "trace + solution code). Every spoken line is short and conversational, like a NeetCode video.",
            CreateLectureArgs, create_lecture, read_only=False),
    McpTool("edit_lecture", "Rewrite a Kojo lecture", "Admin only. Replace a lecture's content.",
            EditLectureArgs, edit_lecture, read_only=False),
    McpTool("reject_lecture_request", "Reject a lecture request", "Admin only. Close a request without a lecture.",
            RejectRequestArgs, reject_lecture_request, read_only=False),
)
