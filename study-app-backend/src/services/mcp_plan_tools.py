from __future__ import annotations

import datetime
from typing import Any, Optional

from pydantic import Field

from src.schemas.study_plan import (
    MAX_PLAN_ITEMS,
    StudyPlanCreateRequest,
    StudyPlanItemCreate,
    StudyPlanItemIn,
    StudyPlanReplaceItemsRequest,
)
from src.services.mcp_tool_base import McpContext, McpTool, ToolArgs, ToolInputError, dump
from src.services.mcp_write_tools import CONFIRM_FIELD, require_confirm
from src.services.study_plan_service import StudyPlanService
from src.utils.exceptions import ResourceNotFoundException, ValidationException


# Open to every connected account since 2026-11-05 (was beta-only). None of
# these tools call an AI model: the connected app writes the plan itself.
# Guests cannot connect at all (routes/mcp.py). Size caps come from the shared
# schemas (MAX_PLAN_ITEMS) and StudyPlanService (MAX_PLANS_PER_USER).


# ---------------------------------------------------------------- args

class ListStudyPlansArgs(ToolArgs):
    pass


class GetStudyPlanArgs(ToolArgs):
    plan_id: int = Field(description="ID of the study plan to fetch.")


class CreateStudyPlanArgs(ToolArgs):
    title: str = Field(min_length=1, max_length=120, description="Title of the study plan.")
    exam_date: Optional[str] = Field(default=None, description="Optional target date in YYYY-MM-DD format.")
    is_pinned: bool = Field(default=False, description="Whether this plan should be pinned to the dashboard.")
    items: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=MAX_PLAN_ITEMS,
        description="List of plan items: kind, label, optional target_id, optional target_count, optional due_date.",
    )


class UpdateStudyPlanItemsArgs(ToolArgs):
    plan_id: int = Field(description="ID of the study plan to update items for.")
    items: list[dict[str, Any]] = Field(
        max_length=MAX_PLAN_ITEMS,
        description="Complete replacement list of items: optional id, kind, label, optional target_id, optional target_count, optional due_date, optional done.",
    )


class SetPlanItemDoneArgs(ToolArgs):
    item_id: int = Field(description="ID of the study plan item.")
    done: bool = Field(description="Whether the item is checked off.")


class DeleteStudyPlanArgs(ToolArgs):
    plan_id: int = Field(description="ID of the study plan to delete.")
    confirm: bool = CONFIRM_FIELD


# ---------------------------------------------------------------- handlers

async def list_study_plans(ctx: McpContext, args: ListStudyPlansArgs) -> dict[str, Any]:
    plans = await StudyPlanService().list_plans(ctx.user.id, ctx.session)
    return {"plans": [dump(p) for p in plans]}


async def get_study_plan(ctx: McpContext, args: GetStudyPlanArgs) -> dict[str, Any]:
    try:
        plan = await StudyPlanService().get_plan(args.plan_id, ctx.user.id, ctx.session)
        return {"plan": dump(plan)}
    except ResourceNotFoundException as exc:
        raise ToolInputError(str(exc)) from exc


async def create_study_plan(ctx: McpContext, args: CreateStudyPlanArgs) -> dict[str, Any]:
    parsed_date: Optional[datetime.date] = None
    if args.exam_date:
        try:
            parsed_date = datetime.date.fromisoformat(args.exam_date.strip())
        except ValueError as exc:
            raise ToolInputError(f"Invalid exam_date format: {args.exam_date}. Expected YYYY-MM-DD.") from exc

    item_creates: list[StudyPlanItemCreate] = []
    for it in args.items:
        try:
            item_creates.append(StudyPlanItemCreate.model_validate(it))
        except Exception as exc:
            raise ToolInputError(f"Invalid study plan item: {exc}") from exc

    req = StudyPlanCreateRequest(
        title=args.title,
        exam_date=parsed_date,
        is_pinned=args.is_pinned,
        items=item_creates,
    )
    try:
        plan = await StudyPlanService().create_plan(ctx.user.id, req, ctx.session)
        return {"plan": dump(plan)}
    except ValidationException as exc:
        raise ToolInputError(str(exc)) from exc


async def update_study_plan_items(ctx: McpContext, args: UpdateStudyPlanItemsArgs) -> dict[str, Any]:
    item_ins: list[StudyPlanItemIn] = []
    for it in args.items:
        try:
            item_ins.append(StudyPlanItemIn.model_validate(it))
        except Exception as exc:
            raise ToolInputError(f"Invalid study plan item: {exc}") from exc

    req = StudyPlanReplaceItemsRequest(items=item_ins)
    try:
        plan = await StudyPlanService().replace_items(args.plan_id, ctx.user.id, req, ctx.session)
        return {"plan": dump(plan)}
    except (ResourceNotFoundException, ValidationException) as exc:
        raise ToolInputError(str(exc)) from exc


async def set_plan_item_done(ctx: McpContext, args: SetPlanItemDoneArgs) -> dict[str, Any]:
    try:
        item = await StudyPlanService().toggle_item_done(args.item_id, ctx.user.id, args.done, ctx.session)
        return {"item": dump(item)}
    except ResourceNotFoundException as exc:
        raise ToolInputError(str(exc)) from exc


async def delete_study_plan(ctx: McpContext, args: DeleteStudyPlanArgs) -> dict[str, Any]:
    require_confirm(args.confirm)
    try:
        await StudyPlanService().delete_plan(args.plan_id, ctx.user.id, ctx.session)
        return {"deleted_plan_id": args.plan_id}
    except ResourceNotFoundException as exc:
        raise ToolInputError(str(exc)) from exc


# ---------------------------------------------------------------- registry

def _read(name: str, title: str, description: str, args: Any, handler: Any) -> McpTool:
    return McpTool(name, title, description, args, handler, read_only=True)


def _write(name: str, title: str, description: str, args: Any, handler: Any, destructive: bool = False) -> McpTool:
    return McpTool(name, title, description, args, handler, read_only=False, destructive=destructive)


PLAN_TOOLS: tuple[McpTool, ...] = (
    _read(
        "list_study_plans",
        "List study plans",
        "List all checklist study plans for the current user, newest and pinned first, with item and done counts.",
        ListStudyPlansArgs,
        list_study_plans,
    ),
    _read(
        "get_study_plan",
        "Get a study plan",
        "Get a study plan by ID with all checklist items, completion state and live progress.",
        GetStudyPlanArgs,
        get_study_plan,
    ),
    _write(
        "create_study_plan",
        "Create a study plan",
        "Create a checklist study plan with a title, optional exam date, optional pin, and items.",
        CreateStudyPlanArgs,
        create_study_plan,
    ),
    _write(
        "update_study_plan_items",
        "Update study plan items",
        "Replace the list of checklist items for a study plan. Existing items with IDs keep their completion state.",
        UpdateStudyPlanItemsArgs,
        update_study_plan_items,
    ),
    _write(
        "set_plan_item_done",
        "Set plan item completion",
        "Check or uncheck one item in a study plan.",
        SetPlanItemDoneArgs,
        set_plan_item_done,
    ),
    _write(
        "delete_study_plan",
        "Delete a study plan",
        "Delete a study plan and all its checklist items. Needs confirm=true.",
        DeleteStudyPlanArgs,
        delete_study_plan,
        destructive=True,
    ),
)
