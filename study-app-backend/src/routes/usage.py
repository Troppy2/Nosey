from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.services.quota_service import QuotaService, is_exempt

router = APIRouter(prefix="/usage", tags=["usage"])


class UsageFeatureDTO(BaseModel):
    feature: str
    used: int
    limit: int
    unit: str
    # Naive UTC, serialized with a trailing Z so the browser parses it as UTC.
    resets_at: Optional[str] = None


class UsageLimitsDTO(BaseModel):
    exempt: bool
    limits_enabled: bool
    window_hours: int
    features: list[UsageFeatureDTO]


def _iso_utc(value: Optional[datetime]) -> Optional[str]:
    return value.replace(microsecond=0).isoformat() + "Z" if value else None


@router.get("/limits", response_model=UsageLimitsDTO)
async def get_usage_limits(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> UsageLimitsDTO:
    """The caller's own usage in the current rolling window. Exempt users
    (admin, beta, guest) still see their real usage, just with no cap."""
    statuses = await QuotaService().get_status(session, user)
    return UsageLimitsDTO(
        exempt=is_exempt(user),
        limits_enabled=settings.usage_limits_enabled,
        window_hours=settings.usage_window_hours,
        features=[
            UsageFeatureDTO(
                feature=s.feature,
                used=s.used,
                limit=s.limit,
                unit=s.unit,
                resets_at=_iso_utc(s.resets_at),
            )
            for s in statuses
        ],
    )
