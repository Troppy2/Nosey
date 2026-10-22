"""Interview prep tools for the Nosey MCP connector: KojoCode (LeetCode mode),
prep banks, 3-Pass drills, mock interviews and System Design topics.

Same contract as the other tool modules: the connected app writes the content,
these tools validate it strictly and save it, and no tool here calls Nosey's
own LLM.

Agreed rules (2026-10-21):
- All of it is beta-only, like the /leetcode, /mock-interview and
  /system-design routers (dependencies.get_beta_user).
- Built-in catalog problems are read-only; only custom ones can be written.
- Drills can be added and removed, never advanced: a pass is the user's.
- A mock interview is set up here and run by the user in Nosey. Creating
  one while an unfinished run exists is refused.
- Every delete needs confirm=true.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import Field, model_validator
from sqlalchemy import select

from src.config import settings
from src.models.lc_sync import LCBankProblem, LCCustomProblem, LCDrillSchedule, LCPrepBank, LCProgress
from src.models.mock_interview import MockInterviewSession
from src.models.system_design import SDConceptProgress, SDCustomTopic, SDSubmission
from src.schemas.mock_interview_schema import CustomProblemRef, MockCustomConfig
from src.services import lc_catalog
from src.services.lc_taxonomy import SUBTOPICS_BY_TOPIC, TOPIC_IDS
from src.services.mcp_tool_base import McpContext, McpTool, ToolArgs, ToolInputError
from src.services.mcp_write_tools import CONFIRM_FIELD, CREATED_VIA, require_confirm, screen
from src.services.sd_custom_topic_service import (
    ExerciseIn,
    QuizIn,
    SDCustomTopicService,
    TopicContentIn,
    VideoIn,
    build_content,
    exercise_out,
    quiz_out,
    stored_content,
    to_concept,
    video_out,
)
from src.utils.exceptions import ResourceNotFoundException
from src.utils.provider_policy import user_can_override_provider

DIFFICULTIES = ("Easy", "Medium", "Hard")
MAX_LIST = 500
MAX_TEST_CASES = 20
MOCK_STAGES = ("resume", "stage1", "stage2", "stage3")
MOCK_STATUS_COMPLETE = "complete"
BUILTIN_COMPANIES = ("google", "meta", "amazon", "apple", "microsoft", "netflix", "random")
SD_SUB_MODULES = ("notes", "video", "visualizer", "project", "quiz")

TOPIC_FIELD_DESCRIPTION = "Topic id, one of: " + ", ".join(sorted(TOPIC_IDS)) + "."


def _url(path: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}{path}"


def _require_beta(ctx: McpContext) -> None:
    if not user_can_override_provider(ctx.user):
        raise ToolInputError("KojoCode, Mock Interview and System Design are beta features this account cannot use yet.")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _check_slug_text(slug: str) -> str:
    slug = slug.strip()
    if not slug or len(slug) > 200:
        raise ToolInputError("problem slugs are 1 to 200 characters.")
    return slug


# ---------------------------------------------------------------- KojoCode problems

async def _custom_rows(ctx: McpContext) -> list[LCCustomProblem]:
    return list(
        (
            await ctx.session.execute(
                select(LCCustomProblem)
                .where(LCCustomProblem.user_id == ctx.user.id)
                .order_by(LCCustomProblem.created_at.asc())
            )
        ).scalars().all()
    )


async def _progress(ctx: McpContext) -> dict[str, LCProgress]:
    rows = (await ctx.session.execute(select(LCProgress).where(LCProgress.user_id == ctx.user.id))).scalars().all()
    return {row.problem_slug: row for row in rows}


def _problem_summary(slug: str, title: str, topic: str, difficulty: str, source: str,
                     progress: Optional[LCProgress]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "slug": slug, "title": title, "topic": topic, "difficulty": difficulty, "source": source,
        "done": bool(progress and progress.done),
    }
    if progress and progress.solved_at:
        out["solved_at"] = progress.solved_at.isoformat()
    return out


class ListProblemsArgs(ToolArgs):
    source: Literal["all", "builtin", "custom"] = Field(
        default="all", description="builtin = Nosey's curated catalog, custom = problems the user (or you) wrote."
    )
    topic: Optional[str] = Field(default=None, description=TOPIC_FIELD_DESCRIPTION)
    difficulty: Optional[Literal["Easy", "Medium", "Hard"]] = None
    status: Literal["all", "done", "todo"] = "all"
    search: Optional[str] = Field(default=None, max_length=200, description="Case-insensitive match on the title.")
    limit: int = Field(default=200, ge=1, le=MAX_LIST)
    offset: int = Field(default=0, ge=0)


async def list_leetcode_problems(ctx: McpContext, args: ListProblemsArgs) -> dict[str, Any]:
    _require_beta(ctx)
    progress = await _progress(ctx)
    items: list[dict[str, Any]] = []
    if args.source in ("all", "builtin"):
        for p in lc_catalog.catalog():
            items.append(_problem_summary(p.slug, p.title, p.topic, p.difficulty, "builtin", progress.get(p.slug)))
    if args.source in ("all", "custom"):
        for row in await _custom_rows(ctx):
            if row.is_archived or row.source != "user":
                continue
            items.append(_problem_summary(row.slug, row.title, row.topic, row.difficulty, "custom",
                                          progress.get(row.slug)))
    needle = (args.search or "").strip().lower()
    items = [
        item for item in items
        if (args.topic is None or item["topic"] == args.topic)
        and (args.difficulty is None or item["difficulty"] == args.difficulty)
        and (args.status == "all" or item["done"] == (args.status == "done"))
        and (not needle or needle in item["title"].lower())
    ]
    page = items[args.offset: args.offset + args.limit]
    return {"total": len(items), "offset": args.offset, "problems": page}


class GetProblemArgs(ToolArgs):
    slug: str = Field(min_length=1, max_length=200)


async def get_leetcode_problem(ctx: McpContext, args: GetProblemArgs) -> dict[str, Any]:
    _require_beta(ctx)
    progress = (await _progress(ctx)).get(args.slug)
    builtin = lc_catalog.get(args.slug)
    if builtin is not None:
        out = _problem_summary(builtin.slug, builtin.title, builtin.topic, builtin.difficulty, "builtin", progress)
        out["subtopics"] = list(builtin.subtopics)
        out["leetcode_url"] = f"https://leetcode.com/problems/{builtin.slug}/"
        return out
    row = await _owned_custom(ctx, args.slug)
    out = _problem_summary(row.slug, row.title, row.topic, row.difficulty, "custom", progress)
    out.update(
        subtopic=row.subtopic,
        description=row.description,
        starter_code=row.starter_code,
        test_cases=json.loads(row.test_cases_json or "[]"),
        is_archived=row.is_archived,
    )
    return out


async def _owned_custom(ctx: McpContext, slug: str) -> LCCustomProblem:
    row = (
        await ctx.session.execute(
            select(LCCustomProblem).where(LCCustomProblem.user_id == ctx.user.id, LCCustomProblem.slug == slug)
        )
    ).scalar_one_or_none()
    if row is None:
        raise ResourceNotFoundException("Custom problem")
    return row


class TestCaseIn(ToolArgs):
    input_text: str = Field(
        min_length=1, max_length=4000,
        description="Python named arguments matching the Solution method's parameters (excluding self), "
        "e.g. `nums = [2, 7, 11, 15], target = 9`.",
    )
    output_text: str = Field(
        min_length=1, max_length=4000, description="One Python literal equal to the expected return, e.g. `[0, 1]`."
    )
    explanation_text: Optional[str] = Field(default=None, max_length=4000)


class ProblemFields(ToolArgs):
    title: str = Field(min_length=1, max_length=300)
    topic: str = Field(description=TOPIC_FIELD_DESCRIPTION)
    subtopic: Optional[str] = Field(
        default=None, max_length=120, description="Optional finer technique; must be one listed for the topic."
    )
    difficulty: Literal["Easy", "Medium", "Hard"]
    description: str = Field(
        min_length=1, max_length=20_000,
        description="Markdown statement written like LeetCode: the task, constraints, and 2 to 3 worked "
        "examples with Input, Output and Explanation.",
    )
    starter_code: str = Field(
        min_length=1, max_length=20_000,
        description="Python `class Solution:` with one method and a `...`/`pass` body, LeetCode style.",
    )
    test_cases: list[TestCaseIn] = Field(min_length=3, max_length=MAX_TEST_CASES,
                                         description="3 or more, correct for the starter signature, incl. an edge case.")

    @model_validator(mode="after")
    def _check(self) -> "ProblemFields":
        _check_topic(self.topic, self.subtopic)
        if "class Solution" not in self.starter_code:
            raise ValueError("starter_code must define `class Solution:`")
        return self


def _check_topic(topic: Optional[str], subtopic: Optional[str]) -> None:
    if topic is not None and topic not in TOPIC_IDS:
        raise ValueError(f"unknown topic {topic!r}. {TOPIC_FIELD_DESCRIPTION}")
    if subtopic and topic and subtopic not in SUBTOPICS_BY_TOPIC.get(topic, []):
        allowed = ", ".join(SUBTOPICS_BY_TOPIC.get(topic, [])) or "none"
        raise ValueError(f"subtopic {subtopic!r} is not listed under {topic}. Allowed: {allowed}")


class CreateProblemArgs(ProblemFields):
    add_to_bank_id: Optional[int] = Field(default=None, description="Also add it to this prep bank.")


async def create_leetcode_problem(ctx: McpContext, args: CreateProblemArgs) -> dict[str, Any]:
    _require_beta(ctx)
    await screen(ctx, args.title, args.description, args.starter_code,
                 *(t for c in args.test_cases for t in (c.input_text, c.output_text, c.explanation_text)))
    bank = await _owned_bank(ctx, args.add_to_bank_id) if args.add_to_bank_id is not None else None
    row = LCCustomProblem(
        user_id=ctx.user.id,
        slug=f"custom-{uuid.uuid4()}",
        title=args.title.strip(),
        topic=args.topic,
        subtopic=(args.subtopic or "").strip() or None,
        difficulty=args.difficulty,
        description=args.description,
        url="",
        starter_code=args.starter_code,
        test_cases_json=json.dumps([c.model_dump() for c in args.test_cases]),
        is_archived=False,
    )
    ctx.session.add(row)
    if bank is not None:
        ctx.session.add(LCBankProblem(bank_id=bank.id, problem_slug=row.slug))
    await ctx.session.commit()
    return {"slug": row.slug, "title": row.title, "url": _url("/leetcode"),
            **({"bank_id": bank.id} if bank is not None else {})}


class EditProblemArgs(ToolArgs):
    slug: str = Field(min_length=1, max_length=200, description="A custom problem's slug (custom-...).")
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    topic: Optional[str] = Field(default=None, description=TOPIC_FIELD_DESCRIPTION)
    subtopic: Optional[str] = Field(default=None, max_length=120, description="Empty string clears it.")
    difficulty: Optional[Literal["Easy", "Medium", "Hard"]] = None
    description: Optional[str] = Field(default=None, min_length=1, max_length=20_000)
    starter_code: Optional[str] = Field(default=None, min_length=1, max_length=20_000)
    test_cases: Optional[list[TestCaseIn]] = Field(default=None, min_length=3, max_length=MAX_TEST_CASES,
                                                   description="Replaces all test cases.")
    archived: Optional[bool] = Field(default=None, description="Hide it from the list, or restore it.")


async def edit_leetcode_problem(ctx: McpContext, args: EditProblemArgs) -> dict[str, Any]:
    _require_beta(ctx)
    row = await _owned_custom(ctx, args.slug)
    topic = args.topic or row.topic
    subtopic = row.subtopic if args.subtopic is None else (args.subtopic.strip() or None)
    try:
        # Older rows can carry a free-text topic; only a known topic constrains the subtopic.
        _check_topic(args.topic, None)
        if subtopic and topic in TOPIC_IDS:
            _check_topic(topic, subtopic)
    except ValueError as exc:
        raise ToolInputError(str(exc)) from exc
    if args.starter_code is not None and "class Solution" not in args.starter_code:
        raise ToolInputError("starter_code must define `class Solution:`")
    await screen(ctx, args.title, args.description, args.starter_code,
                 *(t for c in (args.test_cases or []) for t in (c.input_text, c.output_text, c.explanation_text)))
    if args.title is not None:
        row.title = args.title.strip()
    row.topic = topic
    row.subtopic = subtopic
    if args.difficulty is not None:
        row.difficulty = args.difficulty
    if args.description is not None:
        row.description = args.description
    if args.starter_code is not None:
        row.starter_code = args.starter_code
    if args.test_cases is not None:
        row.test_cases_json = json.dumps([c.model_dump() for c in args.test_cases])
    if args.archived is not None:
        row.is_archived = args.archived
    await ctx.session.commit()
    return {"slug": row.slug, "title": row.title, "is_archived": row.is_archived}


class DeleteProblemArgs(ToolArgs):
    slug: str = Field(min_length=1, max_length=200)
    confirm: bool = CONFIRM_FIELD


async def delete_leetcode_problem(ctx: McpContext, args: DeleteProblemArgs) -> dict[str, Any]:
    _require_beta(ctx)
    require_confirm(args.confirm)
    row = await _owned_custom(ctx, args.slug)
    await ctx.session.delete(row)
    await ctx.session.commit()
    return {"deleted_slug": args.slug}


class ListCompletedArgs(ToolArgs):
    limit: int = Field(default=200, ge=1, le=MAX_LIST)


async def list_completed_problems(ctx: McpContext, args: ListCompletedArgs) -> dict[str, Any]:
    _require_beta(ctx)
    customs = {row.slug: row for row in await _custom_rows(ctx)}
    done = [row for row in (await _progress(ctx)).values() if row.done]
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    done.sort(key=lambda r: r.solved_at.replace(tzinfo=r.solved_at.tzinfo or timezone.utc) if r.solved_at else epoch,
              reverse=True)
    items = []
    for row in done[: args.limit]:
        builtin = lc_catalog.get(row.problem_slug)
        custom = customs.get(row.problem_slug)
        if builtin is not None:
            items.append(_problem_summary(row.problem_slug, builtin.title, builtin.topic, builtin.difficulty,
                                          "builtin", row))
        elif custom is not None:
            items.append(_problem_summary(row.problem_slug, custom.title, custom.topic, custom.difficulty,
                                          "custom", row))
        else:
            items.append(_problem_summary(row.problem_slug, row.problem_slug, "unknown", "unknown", "other", row))
    return {"total_completed": len(done), "problems": items}


# ---------------------------------------------------------------- prep banks

async def _owned_bank(ctx: McpContext, bank_id: int) -> LCPrepBank:
    row = (
        await ctx.session.execute(
            select(LCPrepBank).where(LCPrepBank.id == bank_id, LCPrepBank.user_id == ctx.user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise ResourceNotFoundException("Prep bank")
    return row


async def _bank_slugs(ctx: McpContext, bank_id: int) -> list[str]:
    return list(
        (
            await ctx.session.execute(
                select(LCBankProblem.problem_slug)
                .where(LCBankProblem.bank_id == bank_id)
                .order_by(LCBankProblem.added_at.asc(), LCBankProblem.id.asc())
            )
        ).scalars().all()
    )


async def _known_slugs(ctx: McpContext, slugs: list[str]) -> list[str]:
    """Clean, dedupe and check slugs exist (catalog or the user's custom problems)."""
    cleaned = list(dict.fromkeys(_check_slug_text(s) for s in slugs))
    customs = {row.slug for row in await _custom_rows(ctx)}
    unknown = [s for s in cleaned if lc_catalog.get(s) is None and s not in customs]
    if unknown:
        raise ToolInputError(
            f"Unknown problem slugs: {', '.join(unknown)}. Use list_leetcode_problems for real slugs, "
            "or create_leetcode_problem first."
        )
    return cleaned


async def _bank_out(ctx: McpContext, bank: LCPrepBank) -> dict[str, Any]:
    rows = (
        await ctx.session.execute(
            select(LCBankProblem)
            .where(LCBankProblem.bank_id == bank.id)
            .order_by(LCBankProblem.added_at.asc(), LCBankProblem.id.asc())
        )
    ).scalars().all()
    # Banks are cold practice: done here means solved after being added to this
    # bank (lc_bank_problems.completed_at), not the global done flag.
    completed = [r.problem_slug for r in rows if r.completed_at is not None]
    return {
        "bank_id": bank.id, "name": bank.name, "target": bank.target, "is_active": bank.is_active,
        "problem_slugs": [r.problem_slug for r in rows], "completed_in_bank": completed,
        "done_count": len(completed),
    }


async def _activate(ctx: McpContext, bank: LCPrepBank) -> None:
    # One active bank per user, enforced the same way as routes/leetcode.activate_prep_bank.
    others = (
        await ctx.session.execute(
            select(LCPrepBank).where(
                LCPrepBank.user_id == ctx.user.id, LCPrepBank.id != bank.id, LCPrepBank.is_active.is_(True)
            )
        )
    ).scalars().all()
    for other in others:
        other.is_active = False
    bank.is_active = True


class ListBanksArgs(ToolArgs):
    pass


async def list_prep_banks(ctx: McpContext, args: ListBanksArgs) -> dict[str, Any]:
    _require_beta(ctx)
    rows = (
        await ctx.session.execute(
            select(LCPrepBank).where(LCPrepBank.user_id == ctx.user.id).order_by(LCPrepBank.created_at.asc())
        )
    ).scalars().all()
    return {"banks": [await _bank_out(ctx, row) for row in rows]}


class CreateBankArgs(ToolArgs):
    name: str = Field(min_length=1, max_length=200, description='e.g. "Google SWE intern".')
    target: str = Field(default="", max_length=200, description='What it prepares for, e.g. "Onsite Nov 12".')
    problem_slugs: list[str] = Field(default_factory=list, max_length=MAX_LIST,
                                     description="Built-in or custom slugs, in study order.")
    activate: bool = Field(default=False, description="Make it the active bank (only one is active).")


async def create_prep_bank(ctx: McpContext, args: CreateBankArgs) -> dict[str, Any]:
    _require_beta(ctx)
    await screen(ctx, args.name, args.target)
    slugs = await _known_slugs(ctx, args.problem_slugs)
    bank = LCPrepBank(user_id=ctx.user.id, name=args.name.strip(), target=args.target.strip(), is_active=False)
    ctx.session.add(bank)
    await ctx.session.flush()
    for slug in slugs:
        ctx.session.add(LCBankProblem(bank_id=bank.id, problem_slug=slug))
    if args.activate:
        await _activate(ctx, bank)
    await ctx.session.commit()
    return await _bank_out(ctx, bank)


class EditBankArgs(ToolArgs):
    bank_id: int
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    target: Optional[str] = Field(default=None, max_length=200)
    activate: Optional[bool] = Field(default=None, description="true makes it the active bank; false deactivates it.")


async def edit_prep_bank(ctx: McpContext, args: EditBankArgs) -> dict[str, Any]:
    _require_beta(ctx)
    bank = await _owned_bank(ctx, args.bank_id)
    await screen(ctx, args.name, args.target)
    if args.name is not None:
        bank.name = args.name.strip()
    if args.target is not None:
        bank.target = args.target.strip()
    if args.activate is True:
        await _activate(ctx, bank)
    elif args.activate is False:
        bank.is_active = False
    await ctx.session.commit()
    return await _bank_out(ctx, bank)


class BankProblemsArgs(ToolArgs):
    bank_id: int
    problem_slugs: list[str] = Field(min_length=1, max_length=MAX_LIST)


async def add_bank_problems(ctx: McpContext, args: BankProblemsArgs) -> dict[str, Any]:
    _require_beta(ctx)
    bank = await _owned_bank(ctx, args.bank_id)
    existing = set(await _bank_slugs(ctx, bank.id))
    for slug in await _known_slugs(ctx, args.problem_slugs):
        if slug not in existing:
            ctx.session.add(LCBankProblem(bank_id=bank.id, problem_slug=slug))
    await ctx.session.commit()
    return await _bank_out(ctx, bank)


async def remove_bank_problems(ctx: McpContext, args: BankProblemsArgs) -> dict[str, Any]:
    _require_beta(ctx)
    bank = await _owned_bank(ctx, args.bank_id)
    rows = (
        await ctx.session.execute(
            select(LCBankProblem).where(
                LCBankProblem.bank_id == bank.id, LCBankProblem.problem_slug.in_(args.problem_slugs)
            )
        )
    ).scalars().all()
    for row in rows:
        await ctx.session.delete(row)
    await ctx.session.commit()
    return await _bank_out(ctx, bank)


class DeleteBankArgs(ToolArgs):
    bank_id: int
    confirm: bool = CONFIRM_FIELD


async def delete_prep_bank(ctx: McpContext, args: DeleteBankArgs) -> dict[str, Any]:
    _require_beta(ctx)
    require_confirm(args.confirm)
    bank = await _owned_bank(ctx, args.bank_id)
    await ctx.session.delete(bank)
    await ctx.session.commit()
    return {"deleted_bank_id": args.bank_id}


# ---------------------------------------------------------------- 3-Pass drills

def _drill_out(row: LCDrillSchedule, now: datetime) -> dict[str, Any]:
    builtin = lc_catalog.get(row.problem_slug)
    due_at = row.next_due_at if row.next_due_at.tzinfo else row.next_due_at.replace(tzinfo=timezone.utc)
    out: dict[str, Any] = {
        "slug": row.problem_slug,
        "pass": row.current_pass,
        "next_due_at": due_at.isoformat(),
        "is_due": row.completed_at is None and due_at <= now,
        "added_from": row.added_from,
        "completed_at": _iso(row.completed_at),
    }
    if builtin is not None:
        out["title"] = builtin.title
    return out


class ListDrillsArgs(ToolArgs):
    include_completed: bool = Field(default=False, description="Also list drills cleared on pass 3.")


async def list_drills(ctx: McpContext, args: ListDrillsArgs) -> dict[str, Any]:
    _require_beta(ctx)
    query = select(LCDrillSchedule).where(LCDrillSchedule.user_id == ctx.user.id)
    if not args.include_completed:
        query = query.where(LCDrillSchedule.completed_at.is_(None))
    rows = (await ctx.session.execute(query.order_by(LCDrillSchedule.next_due_at.asc()))).scalars().all()
    customs = {row.slug: row.title for row in await _custom_rows(ctx)}
    now = datetime.now(timezone.utc)
    drills = []
    for row in rows:
        out = _drill_out(row, now)
        out.setdefault("title", customs.get(row.problem_slug, row.problem_slug))
        drills.append(out)
    return {
        "about": "3-Pass Drill: a problem is re-solved on pass 1, then 24h later pass 2, then 72h later pass 3. "
        "Only the user advances a pass, in Nosey.",
        "due_now": sum(1 for d in drills if d["is_due"]),
        "drills": drills,
    }


class AddDrillArgs(ToolArgs):
    problem_slugs: list[str] = Field(min_length=1, max_length=50)


async def add_drills(ctx: McpContext, args: AddDrillArgs) -> dict[str, Any]:
    _require_beta(ctx)
    slugs = await _known_slugs(ctx, args.problem_slugs)
    existing = set(
        (
            await ctx.session.execute(
                select(LCDrillSchedule.problem_slug).where(
                    LCDrillSchedule.user_id == ctx.user.id, LCDrillSchedule.problem_slug.in_(slugs)
                )
            )
        ).scalars().all()
    )
    now = datetime.now(timezone.utc)
    added = [s for s in slugs if s not in existing]
    for slug in added:
        # Same as POST /leetcode/drills: pass 1, due now. One row per problem ever.
        ctx.session.add(LCDrillSchedule(user_id=ctx.user.id, problem_slug=slug, current_pass=1,
                                        next_due_at=now, added_from="manual"))
    await ctx.session.commit()
    return {"added": added, "already_drilling": [s for s in slugs if s in existing]}


class RemoveDrillArgs(ToolArgs):
    problem_slugs: list[str] = Field(min_length=1, max_length=50)
    confirm: bool = CONFIRM_FIELD


async def remove_drills(ctx: McpContext, args: RemoveDrillArgs) -> dict[str, Any]:
    _require_beta(ctx)
    require_confirm(args.confirm)
    rows = (
        await ctx.session.execute(
            select(LCDrillSchedule).where(
                LCDrillSchedule.user_id == ctx.user.id, LCDrillSchedule.problem_slug.in_(args.problem_slugs)
            )
        )
    ).scalars().all()
    for row in rows:
        await ctx.session.delete(row)
    await ctx.session.commit()
    return {"removed": [row.problem_slug for row in rows]}


# ---------------------------------------------------------------- mock interviews

def _json_or_none(raw: Optional[str]) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def _mock_summary(row: MockInterviewSession) -> dict[str, Any]:
    return {
        "session_id": row.id,
        "company": row.custom_company if row.company == "custom" else row.company,
        "level": row.level,
        "stages": _json_or_none(row.stages_config),
        "status": row.status,
        "created_at": _iso(row.created_at),
        "url": _url(f"/mock-interview/{row.id}/summary" if row.status == MOCK_STATUS_COMPLETE else "/mock-interview"),
    }


async def _owned_mock(ctx: McpContext, session_id: int) -> MockInterviewSession:
    row = (
        await ctx.session.execute(
            select(MockInterviewSession).where(
                MockInterviewSession.id == session_id, MockInterviewSession.user_id == ctx.user.id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise ResourceNotFoundException("Mock interview")
    return row


class ListMocksArgs(ToolArgs):
    pass


async def list_mock_interviews(ctx: McpContext, args: ListMocksArgs) -> dict[str, Any]:
    _require_beta(ctx)
    rows = (
        await ctx.session.execute(
            select(MockInterviewSession)
            .where(MockInterviewSession.user_id == ctx.user.id)
            .order_by(MockInterviewSession.created_at.desc())
        )
    ).scalars().all()
    return {"interviews": [_mock_summary(row) for row in rows]}


class GetMockArgs(ToolArgs):
    session_id: int


async def get_mock_interview(ctx: McpContext, args: GetMockArgs) -> dict[str, Any]:
    _require_beta(ctx)
    row = await _owned_mock(ctx, args.session_id)
    out = _mock_summary(row)
    out.update(
        custom_config=_json_or_none(row.custom_config),
        resume_screen=_json_or_none(row.resume_screen),
        resume_deep_dive=_json_or_none(row.resume_grill),
        stage1_online_assessment=_json_or_none(row.stage1_results),
        stage2_technical=_json_or_none(row.stage2_submission),
        stage3_behavioral=_json_or_none(row.stage3_answers),
        overall_feedback=row.overall_feedback,
    )
    return out


class CreateMockArgs(ToolArgs):
    company: str = Field(
        min_length=1, max_length=120,
        description="One of google, meta, amazon, apple, microsoft, netflix, random; any other name makes a "
        "custom-company interview built from job_description and the fields below.",
    )
    level: Literal["intern", "junior", "mid", "senior"] = "intern"
    stages: list[Literal["resume", "stage1", "stage2", "stage3"]] = Field(
        default_factory=lambda: list(MOCK_STAGES),
        description="resume = ATS resume screen + deep dive, stage1 = online assessment (coding), "
        "stage2 = technical interview, stage3 = behavioral. Run in this order.",
    )
    job_description: Optional[str] = Field(default=None, max_length=20_000, description="Custom company only.")
    role_focus: str = Field(default="", max_length=600, description="Custom only: what the company weighs.")
    culture: str = Field(default="", max_length=600, description="Custom only: culture for the behavioral round.")
    topics: list[str] = Field(default_factory=list, max_length=12,
                              description="Custom only: topic ids the coding rounds draw from. " + TOPIC_FIELD_DESCRIPTION)
    problem_slugs: list[str] = Field(
        default_factory=list, max_length=20,
        description="Custom only: exact problems for the coding rounds (built-in or custom slugs).",
    )

    @model_validator(mode="after")
    def _check(self) -> "CreateMockArgs":
        if not self.stages:
            raise ValueError("pick at least one stage")
        bad = [t for t in self.topics if t not in TOPIC_IDS]
        if bad:
            raise ValueError(f"unknown topics {bad}. {TOPIC_FIELD_DESCRIPTION}")
        return self


async def create_mock_interview(ctx: McpContext, args: CreateMockArgs) -> dict[str, Any]:
    _require_beta(ctx)
    unfinished = (
        await ctx.session.execute(
            select(MockInterviewSession.id).where(
                MockInterviewSession.user_id == ctx.user.id,
                MockInterviewSession.status != MOCK_STATUS_COMPLETE,
                MockInterviewSession.progress_json.is_not(None),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if unfinished is not None:
        raise ToolInputError(
            f"The user has an unfinished mock interview (session_id {unfinished}). Ask them to finish it in "
            "Nosey, or delete it with delete_mock_interview if they say so, then try again."
        )
    company = args.company.strip()
    key = company.lower()
    await screen(ctx, company, args.job_description, args.role_focus, args.culture)
    stages = [s for s in MOCK_STAGES if s in args.stages]
    custom_company = custom_config = jd_text = None
    if key in BUILTIN_COMPANIES:
        company_key = key
    else:
        company_key = "custom"
        custom_company = company
        jd_text = args.job_description or None
        problems = []
        for slug in await _known_slugs(ctx, args.problem_slugs):
            builtin = lc_catalog.get(slug)
            problems.append(CustomProblemRef(slug=slug, title=builtin.title if builtin else slug,
                                             difficulty=builtin.difficulty if builtin else "Medium"))
        custom_config = MockCustomConfig(
            role_focus=args.role_focus, culture=args.culture, topics=args.topics, problems=problems
        ).model_dump_json()
    row = MockInterviewSession(
        user_id=ctx.user.id, company=company_key, level=args.level, custom_company=custom_company,
        jd_text=jd_text, custom_config=custom_config, stages_config=json.dumps(stages), status="pending",
    )
    ctx.session.add(row)
    await ctx.session.commit()
    out = _mock_summary(row)
    out["url"] = _url(f"/mock-interview/{row.id}/{stages[0]}")
    return out


class DeleteMockArgs(ToolArgs):
    session_id: int
    confirm: bool = CONFIRM_FIELD


async def delete_mock_interview(ctx: McpContext, args: DeleteMockArgs) -> dict[str, Any]:
    _require_beta(ctx)
    require_confirm(args.confirm)
    row = await _owned_mock(ctx, args.session_id)
    await ctx.session.delete(row)
    await ctx.session.commit()
    return {"deleted_session_id": args.session_id}


# ---------------------------------------------------------------- System Design

def _sd_progress_out(row: Optional[SDConceptProgress]) -> dict[str, Any]:
    if row is None:
        return {"done": [], "complete": False}
    return {
        "done": [name for name in SD_SUB_MODULES if getattr(row, f"{name}_done")],
        "quiz_best_score": row.quiz_best_score,
        "complete": row.completed_at is not None,
    }


class ListSdTopicsArgs(ToolArgs):
    pass


async def list_sd_topics(ctx: McpContext, args: ListSdTopicsArgs) -> dict[str, Any]:
    _require_beta(ctx)
    progress = {
        row.concept_id: row
        for row in (
            await ctx.session.execute(select(SDConceptProgress).where(SDConceptProgress.user_id == ctx.user.id))
        ).scalars().all()
    }
    custom = await SDCustomTopicService().list(ctx.user.id, ctx.session)
    custom_ids = {row.concept_id for row in custom}
    return {
        "about": "Each topic has five sub-modules: notes, video, visualizer, project, quiz.",
        "builtin_progress": [
            {"concept_id": cid, **_sd_progress_out(row)} for cid, row in progress.items() if cid not in custom_ids
        ],
        "custom_topics": [
            {"topic_id": row.id, "concept_id": row.concept_id, "title": row.title,
             "url": _url(f"/system-design/{row.concept_id}"), **_sd_progress_out(progress.get(row.concept_id))}
            for row in custom
        ],
    }


class GetSdTopicArgs(ToolArgs):
    topic_id: int = Field(description="topic_id from list_sd_topics (custom topics only).")


async def get_sd_topic(ctx: McpContext, args: GetSdTopicArgs) -> dict[str, Any]:
    _require_beta(ctx)
    row = await SDCustomTopicService().get_owned(ctx.user.id, args.topic_id, ctx.session)
    return {"topic_id": row.id, **to_concept(row, row.id)}


def _content_texts(content: dict[str, Any]) -> list[Optional[str]]:
    texts: list[Optional[str]] = [content.get("blurb"), content.get("notes")]
    for kind in ("visualizer", "project"):
        exercise = content.get(kind) or {}
        texts += [exercise.get("title"), exercise.get("brief"), exercise.get("simGuide")]
    quiz = content.get("quiz") or {}
    texts += [q.get("prompt") for q in quiz.get("mcq", [])] + [o for q in quiz.get("mcq", []) for o in q["options"]]
    texts += [t for q in quiz.get("frq", []) for t in (q.get("prompt"), q.get("rubric"))]
    return texts


class CreateSdTopicArgs(TopicContentIn, ToolArgs):
    pass


async def create_sd_topic(ctx: McpContext, args: CreateSdTopicArgs) -> dict[str, Any]:
    _require_beta(ctx)
    content = build_content(args)
    await screen(ctx, args.title, *_content_texts(content))
    row = SDCustomTopic(user_id=ctx.user.id, title=args.title.strip(), content_json=json.dumps(content),
                        created_via=CREATED_VIA)
    ctx.session.add(row)
    await ctx.session.commit()
    return {"topic_id": row.id, "concept_id": row.concept_id, "url": _url(f"/system-design/{row.concept_id}"),
            "embedded_video": bool(content["video"] and content["video"]["youtubeId"])}


class EditSdTopicArgs(ToolArgs):
    topic_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    blurb: Optional[str] = Field(default=None, min_length=1, max_length=300)
    notes: Optional[str] = Field(default=None, min_length=200, max_length=100_000)
    video: Optional[VideoIn] = None
    remove_video: bool = False
    visualizer: Optional[ExerciseIn] = Field(default=None, description="Replaces the whole visualizer exercise.")
    project: Optional[ExerciseIn] = Field(default=None, description="Replaces the whole project exercise.")
    quiz: Optional[QuizIn] = Field(default=None, description="Replaces the whole quiz.")


async def edit_sd_topic(ctx: McpContext, args: EditSdTopicArgs) -> dict[str, Any]:
    _require_beta(ctx)
    row = await SDCustomTopicService().get_owned(ctx.user.id, args.topic_id, ctx.session)
    if args.video is not None and args.remove_video:
        raise ToolInputError("Send video or remove_video, not both.")
    content = stored_content(row)
    patch: dict[str, Any] = {}
    if args.blurb is not None:
        patch["blurb"] = args.blurb
    if args.notes is not None:
        patch["notes"] = args.notes
    if args.video is not None or args.remove_video:
        patch["video"] = video_out(args.video)
    if args.visualizer is not None:
        patch["visualizer"] = exercise_out("visualizer", args.visualizer)
    if args.project is not None:
        patch["project"] = exercise_out("project", args.project)
    if args.quiz is not None:
        patch["quiz"] = quiz_out(args.quiz)
    await screen(ctx, args.title, *_content_texts(patch))
    content.update(patch)
    if args.title is not None:
        row.title = args.title.strip()
    row.content_json = json.dumps(content)
    await ctx.session.commit()
    # Progress is kept: a changed exercise or quiz keeps its done flag until the user reruns it.
    return {"topic_id": row.id, "updated": sorted(patch) + (["title"] if args.title is not None else [])}


class DeleteSdTopicArgs(ToolArgs):
    topic_id: int
    confirm: bool = CONFIRM_FIELD


async def delete_sd_topic(ctx: McpContext, args: DeleteSdTopicArgs) -> dict[str, Any]:
    _require_beta(ctx)
    require_confirm(args.confirm)
    row = await SDCustomTopicService().get_owned(ctx.user.id, args.topic_id, ctx.session)
    concept_id = row.concept_id
    progress = (
        await ctx.session.execute(
            select(SDConceptProgress).where(
                SDConceptProgress.user_id == ctx.user.id, SDConceptProgress.concept_id == concept_id
            )
        )
    ).scalars().all()
    submissions = (
        await ctx.session.execute(
            select(SDSubmission).where(
                SDSubmission.user_id == ctx.user.id,
                SDSubmission.exercise_id.in_([f"{concept_id}:visualizer", f"{concept_id}:project"]),
            )
        )
    ).scalars().all()
    for item in (*progress, *submissions):
        await ctx.session.delete(item)
    await ctx.session.delete(row)
    await ctx.session.commit()
    return {"deleted_topic_id": args.topic_id}


# ---------------------------------------------------------------- registry

def _read(name: str, title: str, description: str, args, handler) -> McpTool:
    return McpTool(name, title, description, args, handler)


def _write(name: str, title: str, description: str, args, handler, destructive: bool = False) -> McpTool:
    return McpTool(name, title, description, args, handler, read_only=False, destructive=destructive)


INTERVIEW_TOOLS: tuple[McpTool, ...] = (
    _read("list_leetcode_problems", "List KojoCode problems",
          "List coding problems in KojoCode (Nosey's LeetCode mode): the built-in catalog and the user's custom "
          "problems, each with done/solved state. Filter by source, topic, difficulty, status or title.",
          ListProblemsArgs, list_leetcode_problems),
    _read("get_leetcode_problem", "Get a KojoCode problem",
          "One problem by slug. Custom problems include the statement, starter code and test cases.",
          GetProblemArgs, get_leetcode_problem),
    _read("list_completed_problems", "List completed problems",
          "Problems the user has solved, most recent first, with when.", ListCompletedArgs, list_completed_problems),
    _write("create_leetcode_problem", "Create a KojoCode problem",
           "Write a new LeetCode-style problem: statement, Python `class Solution` starter code and runnable test "
           "cases. It appears in the user's Custom Questions and can go into a prep bank or a drill.",
           CreateProblemArgs, create_leetcode_problem),
    _write("edit_leetcode_problem", "Edit a KojoCode problem",
           "Change a custom problem. Built-in problems cannot be edited.", EditProblemArgs, edit_leetcode_problem),
    _write("delete_leetcode_problem", "Delete a KojoCode problem", "Delete a custom problem. Needs confirm=true.",
           DeleteProblemArgs, delete_leetcode_problem, destructive=True),
    _read("list_prep_banks", "List prep banks",
          "The user's prep banks (problem sets for a target interview), with their problems and which were "
          "solved in that bank. A bank is cold practice: problems solved before they were added still count "
          "as not done there.",
          ListBanksArgs, list_prep_banks),
    _write("create_prep_bank", "Create a prep bank",
           "Create a prep bank from built-in or custom problem slugs, optionally making it the active one.",
           CreateBankArgs, create_prep_bank),
    _write("edit_prep_bank", "Edit a prep bank", "Rename a bank, change its target, or (de)activate it.",
           EditBankArgs, edit_prep_bank),
    _write("add_bank_problems", "Add problems to a prep bank", "Append problems to a bank; repeats are skipped.",
           BankProblemsArgs, add_bank_problems),
    _write("remove_bank_problems", "Remove problems from a prep bank", "Take problems out of a bank.",
           BankProblemsArgs, remove_bank_problems),
    _write("delete_prep_bank", "Delete a prep bank", "Delete a bank (not its problems). Needs confirm=true.",
           DeleteBankArgs, delete_prep_bank, destructive=True),
    _read("list_drills", "List 3-Pass drills",
          "Problems in the user's 3-Pass Drill, with the pass they are on and whether they are due now.",
          ListDrillsArgs, list_drills),
    _write("add_drills", "Add problems to the drill",
           "Schedule problems for the 3-Pass Drill (pass 1, due now). Only the user advances passes.",
           AddDrillArgs, add_drills),
    _write("remove_drills", "Remove problems from the drill", "Take problems out of the drill. Needs confirm=true.",
           RemoveDrillArgs, remove_drills, destructive=True),
    _read("list_mock_interviews", "List mock interviews", "The user's mock interviews, newest first.",
          ListMocksArgs, list_mock_interviews),
    _read("get_mock_interview", "Get a mock interview's results",
          "Everything saved on one mock interview: resume screen, each stage's results and feedback, and the "
          "overall debrief.", GetMockArgs, get_mock_interview),
    _write("create_mock_interview", "Set up a mock interview",
           "Set up a mock interview loop for the user to run in Nosey: a built-in company, or any other company "
           "with a job description, focus, topics and exact problems. Refused while an unfinished run exists. "
           "Returns the URL to start it.", CreateMockArgs, create_mock_interview),
    _write("delete_mock_interview", "Delete a mock interview",
           "Delete a past or unfinished mock interview and its results. Needs confirm=true.",
           DeleteMockArgs, delete_mock_interview, destructive=True),
    _read("list_sd_topics", "List System Design topics",
          "System Design progress on the built-in topics plus every custom topic.", ListSdTopicsArgs, list_sd_topics),
    _read("get_sd_topic", "Get a System Design topic", "A custom topic's full content.", GetSdTopicArgs, get_sd_topic),
    _write("create_sd_topic", "Create a System Design topic",
           "Write a complete System Design topic, shown under Your topics with the same five sub-modules as the "
           "built-in ones: notes, a video (YouTube embeds; other links open in a new tab), a visualizer and a "
           "project (Python exercises with hidden tests that run in the browser), and a quiz (3 to 10 multiple "
           "choice plus 3 to 10 written answers graded against the notes).",
           CreateSdTopicArgs, create_sd_topic),
    _write("edit_sd_topic", "Edit a System Design topic",
           "Change parts of a custom topic. Each exercise or the quiz is replaced whole. Progress is kept.",
           EditSdTopicArgs, edit_sd_topic),
    _write("delete_sd_topic", "Delete a System Design topic",
           "Delete a custom topic and the user's progress on it. Needs confirm=true.",
           DeleteSdTopicArgs, delete_sd_topic, destructive=True),
)
