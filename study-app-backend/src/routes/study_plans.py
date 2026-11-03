import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_beta_user
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
from src.services.llm_service import LLMService
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


@router.get("", response_model=List[StudyPlanSummaryResponse])
async def list_study_plans(
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> List[StudyPlanSummaryResponse]:
    return await StudyPlanService().list_plans(user.id, session)


@router.get("/pinned", response_model=Optional[StudyPlanDetailResponse])
async def get_pinned_study_plan(
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> Optional[StudyPlanDetailResponse]:
    return await StudyPlanService().get_pinned_plan(user.id, session)


@router.get("/catalog", response_model=CatalogResponse)
async def get_study_plans_catalog(
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> CatalogResponse:
    return await StudyPlanService().get_catalog(user.id, session)


@router.post("/draft", response_model=StudyPlanDraftResponse)
async def create_study_plan_draft(
    data: StudyPlanDraftRequest,
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDraftResponse:
    bind_usage(user.id, feature="study_plan_draft")
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


@router.patch("/items/{item_id}", response_model=StudyPlanItemResponse)
async def toggle_plan_item(
    item_id: int,
    data: StudyPlanItemToggleRequest,
    user: User = Depends(get_beta_user),
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
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDetailResponse:
    try:
        return await StudyPlanService().get_plan(plan_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("", response_model=StudyPlanDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_study_plan(
    data: StudyPlanCreateRequest,
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDetailResponse:
    try:
        return await StudyPlanService().create_plan(user.id, data, session)
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{plan_id}", response_model=StudyPlanDetailResponse)
async def update_study_plan(
    plan_id: int,
    data: StudyPlanUpdateRequest,
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlanDetailResponse:
    try:
        return await StudyPlanService().update_plan(plan_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{plan_id}/items", response_model=StudyPlanDetailResponse)
async def replace_study_plan_items(
    plan_id: int,
    data: StudyPlanReplaceItemsRequest,
    user: User = Depends(get_beta_user),
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
async def delete_study_plan(
    plan_id: int,
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await StudyPlanService().delete_plan(plan_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@users_router.patch("/me/dashboard-widgets")
async def update_dashboard_widgets(
    data: DashboardWidgetsUpdateRequest,
    user: User = Depends(get_beta_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        updated_user = await UserRepository(session).update_dashboard_widgets(user, data.widgets)
        await session.commit()
        from src.models.user import parse_dashboard_widgets
        return {"dashboard_widgets": parse_dashboard_widgets(updated_user.dashboard_widgets)}
    except Exception as exc:
        logger.exception("Failed to update dashboard widgets")
        raise HTTPException(status_code=500, detail="Failed to update dashboard widgets") from exc
