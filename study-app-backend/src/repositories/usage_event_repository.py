from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select

from src.models.usage_event import UsageEvent
from src.repositories.base_repository import BaseRepository


class UsageEventRepository(BaseRepository[UsageEvent]):
    async def log_event(
        self,
        user_id: int,
        feature: str,
        duration_ms: int,
        estimated_tokens: Optional[int] = None,
    ) -> UsageEvent:
        event = UsageEvent(
            user_id=user_id,
            feature=feature,
            duration_ms=duration_ms,
            estimated_tokens=estimated_tokens,
        )
        self.session.add(event)
        await self.session.flush()
        return event

    async def get_total_tokens(self) -> int:
        result = await self.session.scalar(
            select(func.sum(UsageEvent.estimated_tokens))
        )
        return int(result or 0)

    async def get_tokens_by_user(self, user_id: int) -> int:
        result = await self.session.scalar(
            select(func.sum(UsageEvent.estimated_tokens)).where(UsageEvent.user_id == user_id)
        )
        return int(result or 0)

    async def get_avg_duration_by_feature(self) -> list[dict]:
        result = await self.session.execute(
            select(
                UsageEvent.feature,
                func.avg(UsageEvent.duration_ms).label("avg_ms"),
                func.count(UsageEvent.id).label("call_count"),
            ).group_by(UsageEvent.feature)
        )
        return [
            {"feature": row.feature, "avg_ms": float(row.avg_ms), "call_count": row.call_count}
            for row in result.all()
        ]

    async def get_total_events(self) -> int:
        result = await self.session.scalar(select(func.count()).select_from(UsageEvent))
        return int(result or 0)

    async def get_tokens_per_user(self) -> list[dict]:
        result = await self.session.execute(
            select(
                UsageEvent.user_id,
                func.sum(UsageEvent.estimated_tokens).label("total_tokens"),
                func.count(UsageEvent.id).label("call_count"),
            ).group_by(UsageEvent.user_id)
        )
        return [
            {
                "user_id": row.user_id,
                "total_tokens": int(row.total_tokens or 0),
                "call_count": row.call_count,
            }
            for row in result.all()
        ]
