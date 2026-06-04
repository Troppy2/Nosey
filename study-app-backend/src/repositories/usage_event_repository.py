from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import case, func, select, text

from src.models.usage_event import UsageEvent
from src.repositories.base_repository import BaseRepository


class UsageEventRepository(BaseRepository[UsageEvent]):
    async def log_event(
        self,
        user_id: int,
        feature: str,
        duration_ms: int,
        estimated_tokens: Optional[int] = None,
        provider: Optional[str] = None,
        success: bool = True,
        error_type: Optional[str] = None,
    ) -> UsageEvent:
        event = UsageEvent(
            user_id=user_id,
            feature=feature,
            duration_ms=duration_ms,
            estimated_tokens=estimated_tokens,
            provider=provider,
            success=success,
            error_type=error_type,
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

    async def get_feature_stats(self) -> list[dict]:
        """Per-feature: call count, error count, avg response time, sorted by call_count desc."""
        result = await self.session.execute(
            select(
                UsageEvent.feature,
                func.count(UsageEvent.id).label("call_count"),
                func.sum(case((UsageEvent.success == False, 1), else_=0)).label("error_count"),
                func.avg(UsageEvent.duration_ms).label("avg_ms"),
            ).group_by(UsageEvent.feature)
            .order_by(func.count(UsageEvent.id).desc())
        )
        rows = result.all()
        return [
            {
                "feature": row.feature,
                "call_count": row.call_count,
                "error_count": int(row.error_count or 0),
                "avg_ms": float(row.avg_ms or 0),
                "error_rate": round(int(row.error_count or 0) / row.call_count, 4) if row.call_count else 0.0,
            }
            for row in rows
        ]

    async def get_provider_stats(self) -> list[dict]:
        """Per-provider (LLM): call count, success/failure, avg response time."""
        result = await self.session.execute(
            select(
                UsageEvent.provider,
                func.count(UsageEvent.id).label("call_count"),
                func.sum(case((UsageEvent.success == True, 1), else_=0)).label("success_count"),
                func.sum(case((UsageEvent.success == False, 1), else_=0)).label("error_count"),
                func.avg(UsageEvent.duration_ms).label("avg_ms"),
            ).where(UsageEvent.provider.isnot(None))
            .group_by(UsageEvent.provider)
            .order_by(func.count(UsageEvent.id).desc())
        )
        rows = result.all()
        return [
            {
                "provider": row.provider,
                "call_count": row.call_count,
                "success_count": int(row.success_count or 0),
                "error_count": int(row.error_count or 0),
                "avg_ms": float(row.avg_ms or 0),
                "success_rate": round(int(row.success_count or 0) / row.call_count, 4) if row.call_count else 0.0,
            }
            for row in rows
        ]

    async def get_daily_counts(self, days: int = 14) -> list[dict]:
        """Event counts per day for the last N days, oldest first."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.session.execute(
            select(
                func.date_trunc("day", UsageEvent.created_at).label("day"),
                func.count(UsageEvent.id).label("count"),
            ).where(UsageEvent.created_at >= cutoff)
            .group_by(text("1"))
            .order_by(text("1"))
        )
        return [{"date": row.day.date().isoformat(), "count": row.count} for row in result.all()]

    async def get_active_users_count(self, days: int = 7) -> int:
        """Count of distinct users with at least one event in the last N days."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await self.session.scalar(
            select(func.count(func.distinct(UsageEvent.user_id))).where(
                UsageEvent.created_at >= cutoff
            )
        )
        return int(result or 0)

    async def get_error_breakdown(self) -> list[dict]:
        """Error type frequency across all events."""
        result = await self.session.execute(
            select(
                UsageEvent.error_type,
                UsageEvent.feature,
                func.count(UsageEvent.id).label("count"),
            ).where(UsageEvent.success == False, UsageEvent.error_type.isnot(None))
            .group_by(UsageEvent.error_type, UsageEvent.feature)
            .order_by(func.count(UsageEvent.id).desc())
        )
        return [
            {"error_type": row.error_type, "feature": row.feature, "count": row.count}
            for row in result.all()
        ]
