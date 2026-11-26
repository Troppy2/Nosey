"""MCP tools for Pattern Trails content (spec section 5): add or update a topic with
its paths, steps and gate pool without a deploy, and list what exists.

Trail content is shared by every user (and a gate item's cue is shown to them and
read by Kojo), so writing it is admin-only, like lectures. Listing is open to the
beta accounts that can use the feature. Per-user progress is never touched here.
"""
from __future__ import annotations

from typing import Any

from pydantic import Field

from src.services.mcp_interview_tools import _require_beta
from src.services.mcp_lecture_tools import _require_admin
from src.services.mcp_tool_base import McpContext, McpTool, ToolArgs, ToolInputError
from src.services.pattern_trails import content
from src.utils.exceptions import ValidationException


class AddTrailArgs(ToolArgs):
    topic: content.TopicIn = Field(
        description=(
            "A topic with its paths (subtopics), up to 5 steps per path (problem slugs, easy to hard) "
            "and its recognition-gate pool. Repeats are updated in place by slug. Problems missing from the "
            "built-in KojoCode catalog are skipped and listed in the result."
        )
    )


class ListTrailsArgs(ToolArgs):
    pass


async def add_trail_content(ctx: McpContext, args: AddTrailArgs) -> dict[str, Any]:
    _require_admin(ctx)
    try:
        report = await content.upsert_topic(ctx.session, args.topic)
    except ValidationException as exc:
        await ctx.session.rollback()
        raise ToolInputError(str(exc)) from exc
    return report.as_dict()


async def list_trails(ctx: McpContext, args: ListTrailsArgs) -> dict[str, Any]:
    _require_beta(ctx)
    return {"topics": await content.list_trails(ctx.session)}


TRAIL_TOOLS: tuple[McpTool, ...] = (
    McpTool(
        "list_trails",
        "List Pattern Trails",
        "List every Pattern Trails topic with its paths, steps and gate problems.",
        ListTrailsArgs,
        list_trails,
    ),
    McpTool(
        "add_trail_content",
        "Add or update a Pattern Trails topic",
        "Create or update a Pattern Trails topic by slug: its paths, steps (built-in KojoCode problem slugs, easy "
        "to hard) and recognition-gate pool. Shared by every user, so admin accounts only. Unknown problems are "
        "skipped and reported.",
        AddTrailArgs,
        add_trail_content,
        read_only=False,
    ),
)
