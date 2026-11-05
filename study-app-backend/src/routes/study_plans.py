import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_account_user, get_current_user
from src.limiter import limiter
from src.models.user import User
from src.repositories.user_repository import UserRepository
from src.schemas.study_plan import (
    CatalogResponse,
    DashboardWidgetsUpdateRequest,
    StudyPlanCreateRequest,
    StudyPlanDetailResponse,
    StudyPlanDraftRequest,
    StudyPlanDraftResponse,
    StudyPlanItemResponse,
    StudyPlanItemToggleRequest,
    StudyPlanReplaceItemsRequest,
    StudyPlanSummaryResponse,
    StudyPlanUpdateRequest,
)
from src.services.account_safety_service import screen_user_input
from src.services.llm_service import LLMService
from src.services.quota_service import QuotaService, is_guest
from src.services.study_plan_service import StudyPlanService
from src.utils.exceptions import (
    LLMException,
    ResourceNotFoundException,
    StudyAppException,
    ValidationException,
)
from src.utils.provider_policy import resolve_request_provider
from src.utils.usage_context import bind_usage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/study-plans", tags=["study-plans"])
users_router = APIRouter(prefix="/users", tags=["users"])

# Open to every signed-in Google account (was beta-only until 2026-11-05).
# Guests are blocked from every /study-plans route (get_account_user, 403) and
# cannot pick the study_plan dashboard widget.
# SECURITY: the only route here that spends AI tokens is POST /draft, and it is
# charged to the Kojo token budget below. Everything else is plain DB work,
# bounded by the per-account write limits and the size caps in
# schemas/study_plan.py and StudyPlanService.
#
# Limits are keyed by account (limiter.user_key is the default key), not IP. Generous for a
# person clicking around, tight for a script.
WRITE_LIMIT = "30/minute;300/hour"
# Checking items off is the most frequent action, so it gets more room.
TOGGLE_LIMIT = "60/minute;600/hour"
# Kojo draft: one AI call each. The Kojo token budget is the real cap; this
# stops a burst from queueing many calls before the budget sees their tokens.
DRAFT_LIMIT = "5/minute;30/hour"

# Starts with "kojo_" so quota_service._kojo_usage counts these tokens toward
# the shared Kojo budget (KOJO_FEATURE_PREFIX).
DRAFT_USAGE_FEATURE = "kojo_study_plan_draft"


@router.get("", response_model=List[StudyPlanSummaryResponse])
async def list_study_plans(
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> List[StudyPlanSummaryResponse]:
    return await StudyPlanService().list_plans(user.id, session)


@router.get("/pinned", response_model=Optional[StudyPlanDetailResponse])
async def get_pinned_study_plan(
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> Optional[StudyPlanDetailResponse]:
    return await StudyPlanService().get_pinned_plan(user.id, session)


@router.get("/catalog", response_model=CatalogResponse)
async def get_study_plans_catalog(
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> CatalogResponse:
    return await StudyPlanService().get_catalog(user.id, session)


@router.post("/draft", response_model=StudyPlanDraftResponse)
@limiter.limit(DRAFT_LIMIT)
async def create_study_plan_draft(
    request: Request,
    response: Response,
    data: StudyPlanDraftRequest,
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDraftResponse:
    # Screened before the quota gate and the AI call (GH #173 order).
    await screen_user_input(user, "study_plan_draft", data.text)
    # SECURITY: charge the draft to the user's Kojo token budget (per account
    # AND per device) and hold an in-flight slot, so parallel drafts cannot all
    # pass the budget check before their tokens are recorded. Raises 429 when
    # the budget is spent or Kojo is busy, 428 without a device id. Admins and
    # beta users are exempt, like every other quota.
    slot = await QuotaService().acquire_kojo(session, user)
    try:
        bind_usage(user.id, feature=DRAFT_USAGE_FEATURE)
        catalog = await StudyPlanService().get_catalog(user.id, session)
        catalog_items = [
            {"kind": item.kind, "id": item.id, "title": item.title}
            for group in (
                catalog.tests,
                catalog.modules,
                catalog.flashcards,
                catalog.leetcode,
                catalog.system_design,
                catalog.mock_interview,
            )
            for item in group
        ]
        provider = resolve_request_provider(user, "auto")
        try:
            draft = await LLMService().generate_study_plan_draft(
                dump_text=data.text,
                catalog_items=catalog_items,
                provider=provider,
            )
            return StudyPlanDraftResponse.model_validate(draft)
        except LLMException as exc:
            logger.warning("Study plan draft LLM call failed: %s", exc)
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        slot.release()


@router.patch("/items/{item_id}", response_model=StudyPlanItemResponse)
@limiter.limit(TOGGLE_LIMIT)
async def toggle_plan_item(
    request: Request,
    response: Response,
    item_id: int,
    data: StudyPlanItemToggleRequest,
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanItemResponse:
    try:
        return await StudyPlanService().toggle_item_done(
            item_id=item_id,
            user_id=user.id,
            done=data.done,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{plan_id}", response_model=StudyPlanDetailResponse)
async def get_study_plan(
    plan_id: int,
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDetailResponse:
    try:
        return await StudyPlanService().get_plan(plan_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("", response_model=StudyPlanDetailResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(WRITE_LIMIT)
async def create_study_plan(
    request: Request,
    response: Response,
    data: StudyPlanCreateRequest,
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDetailResponse:
    try:
        return await StudyPlanService().create_plan(user.id, data, session)
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{plan_id}", response_model=StudyPlanDetailResponse)
@limiter.limit(WRITE_LIMIT)
async def update_study_plan(
    request: Request,
    response: Response,
    plan_id: int,
    data: StudyPlanUpdateRequest,
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDetailResponse:
    try:
        return await StudyPlanService().update_plan(plan_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{plan_id}/items", response_model=StudyPlanDetailResponse)
@limiter.limit(WRITE_LIMIT)
async def replace_study_plan_items(
    request: Request,
    response: Response,
    plan_id: int,
    data: StudyPlanReplaceItemsRequest,
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDetailResponse:
    try:
        return await StudyPlanService().replace_items(plan_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(WRITE_LIMIT)
async def delete_study_plan(
    request: Request,
    response: Response,
    plan_id: int,
    user: User = Depends(get_account_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await StudyPlanService().delete_plan(plan_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@users_router.patch("/me/dashboard-widgets")
@limiter.limit(WRITE_LIMIT)
async def update_dashboard_widgets(
    request: Request,
    response: Response,
    data: DashboardWidgetsUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if is_guest(user) and "study_plan" in data.widgets:
        raise HTTPException(status_code=403, detail="Sign in with Google to use study plans.")
    try:
        updated_user = await UserRepository(session).update_dashboard_widgets(user, data.widgets)
        await session.commit()
        from src.models.user import parse_dashboard_widgets
        return {"dashboard_widgets": parse_dashboard_widgets(updated_user.dashboard_widgets)}
    except Exception as exc:
        logger.exception("Failed to update dashboard widgets")
        raise HTTPException(status_code=500, detail="Failed to update dashboard widgets") from exc
