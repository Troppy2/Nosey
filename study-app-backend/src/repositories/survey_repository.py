from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select

from src.models.survey_response import SurveyResponse
from src.repositories.base_repository import BaseRepository


class SurveyRepository(BaseRepository[SurveyResponse]):
    async def create(
        self,
        user_id: int,
        feature: str,
        rating: int,
        comment: Optional[str] = None,
    ) -> SurveyResponse:
        response = SurveyResponse(
            user_id=user_id,
            feature=feature,
            rating=rating,
            comment=comment,
        )
        self.session.add(response)
        await self.session.flush()
        return response

    async def get_summary(self) -> list[dict]:
        """Per-feature response count and average rating, most responses first."""
        result = await self.session.execute(
            select(
                SurveyResponse.feature,
                func.count(SurveyResponse.id).label("count"),
                func.avg(SurveyResponse.rating).label("avg_rating"),
            )
            .group_by(SurveyResponse.feature)
            .order_by(func.count(SurveyResponse.id).desc())
        )
        return [
            {
                "feature": row.feature,
                "count": row.count,
                "avg_rating": round(float(row.avg_rating), 2) if row.avg_rating is not None else 0.0,
            }
            for row in result.all()
        ]

    async def get_recent(self, limit: int = 50) -> list[SurveyResponse]:
        """Most recent responses (for the admin comment feed)."""
        result = await self.session.scalars(
            select(SurveyResponse).order_by(SurveyResponse.created_at.desc()).limit(limit)
        )
        return list(result.all())
