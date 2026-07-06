from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

SurveyFeature = Literal["flashcards", "testing", "kojo"]


class SurveyCreate(BaseModel):
    feature: SurveyFeature
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("comment")
    @classmethod
    def clean_comment(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class SurveyFeatureSummary(BaseModel):
    feature: str
    count: int
    avg_rating: float


class SurveyRecentRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    feature: str
    rating: int
    comment: Optional[str]
    created_at: datetime


class AdminSurveysResponse(BaseModel):
    summary: list[SurveyFeatureSummary]
    recent: list[SurveyRecentRow]
