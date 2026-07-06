from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.repositories.survey_repository import SurveyRepository
from src.schemas.survey_schema import SurveyCreate

router = APIRouter(prefix="/surveys", tags=["surveys"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def submit_survey(
    data: SurveyCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict:
    repo = SurveyRepository(session)
    await repo.create(
        user_id=user.id,
        feature=data.feature,
        rating=data.rating,
        comment=data.comment,
    )
    await session.commit()
    return {"status": "ok"}
