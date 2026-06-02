from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_admin_user, get_current_user
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.repositories.user_repository import UserRepository
from src.schemas.auth_schema import AdminTokenResponse
from src.services.auth_service import AuthService, ADMIN_TOKEN_TTL_SECONDS
from src.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminUserRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: Optional[str]
    profile_picture_url: Optional[str]
    is_admin: bool
    email_verified: bool
    created_at: str
    updated_at: str

    @classmethod
    def from_user(cls, user: User) -> "AdminUserRow":
        return cls(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            profile_picture_url=user.profile_picture_url,
            is_admin=user.is_admin,
            email_verified=user.email_verified,
            created_at=user.created_at.isoformat(),
            updated_at=user.updated_at.isoformat(),
        )


class FeatureTiming(BaseModel):
    feature: str
    avg_ms: float
    call_count: int


class TokenUsageRow(BaseModel):
    user_id: int
    total_tokens: int
    call_count: int


class AdminStatsResponse(BaseModel):
    total_users: int
    total_usage_events: int
    total_tokens_used: int
    feature_timings: list[FeatureTiming]
    tokens_per_user: list[TokenUsageRow]


@router.post("/authenticate", response_model=AdminTokenResponse)
async def admin_authenticate(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AdminTokenResponse:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.email.lower() != settings.admin_email.lower():
        raise HTTPException(status_code=403, detail="Access denied")

    auth_service = AuthService()
    session_id = await auth_service.create_admin_session(current_user, session)
    admin_token = auth_service.generate_admin_jwt(current_user.id, session_id)

    return AdminTokenResponse(
        admin_token=admin_token,
        expires_in_seconds=ADMIN_TOKEN_TTL_SECONDS,
        session_id=session_id,
    )


@router.get("/stats", response_model=AdminStatsResponse)
async def get_admin_stats(
    admin_user: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> AdminStatsResponse:
    user_repo = UserRepository(session)
    usage_repo = UsageEventRepository(session)

    total_users, total_events, total_tokens, feature_timings, tokens_per_user = await _gather_stats(
        user_repo, usage_repo
    )

    return AdminStatsResponse(
        total_users=total_users,
        total_usage_events=total_events,
        total_tokens_used=total_tokens,
        feature_timings=[FeatureTiming(**ft) for ft in feature_timings],
        tokens_per_user=[TokenUsageRow(**tp) for tp in tokens_per_user],
    )


@router.get("/users", response_model=list[AdminUserRow])
async def list_all_users(
    admin_user: User = Depends(get_admin_user),
    session: AsyncSession = Depends(get_session),
) -> list[AdminUserRow]:
    user_repo = UserRepository(session)
    users = await user_repo.get_all_users()
    return [AdminUserRow.from_user(u) for u in users]


async def _gather_stats(user_repo: UserRepository, usage_repo: UsageEventRepository):
    total_users = await user_repo.count_users()
    total_events = await usage_repo.get_total_events()
    total_tokens = await usage_repo.get_total_tokens()
    feature_timings = await usage_repo.get_avg_duration_by_feature()
    tokens_per_user = await usage_repo.get_tokens_per_user()
    return total_users, total_events, total_tokens, feature_timings, tokens_per_user
