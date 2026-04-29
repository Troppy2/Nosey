from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base

if TYPE_CHECKING:
    from src.models.question import Question


class FRQAnswer(Base):
    __tablename__ = "frq_answers"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    question_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    expected_answer: Mapped[str] = mapped_column(Text, nullable=False)

    question: Mapped[Question] = relationship("Question", back_populates="frq_answer")

    def __repr__(self) -> str:
        return f"FRQAnswer(id={self.id!r}, question_id={self.question_id!r})"
