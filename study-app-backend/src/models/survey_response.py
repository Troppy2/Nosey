from __future__ import annotations

from typing import Optional

from sqlalchemy import BigInteger, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base, TimestampMixin


class SurveyResponse(Base, TimestampMixin):
    """A single post-feature satisfaction survey response.

    Analytics-style like UsageEvent: user_id is stored for per-user analysis but
    there is no ORM relationship or FK cascade, so responses are retained as
    aggregate signal even if the user is later deleted.
    """

    __tablename__ = "survey_responses"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), nullable=False, index=True
    )
    # One of: flashcards, testing, kojo
    feature: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # 1-5 satisfaction rating
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"SurveyResponse(id={self.id!r}, feature={self.feature!r}, rating={self.rating!r})"
