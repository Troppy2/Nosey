from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base

if TYPE_CHECKING:
    from src.models.question import Question


class MCQOption(Base):
    __tablename__ = "mcq_options"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    question_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    option_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    question: Mapped[Question] = relationship("Question", back_populates="mcq_options")

    def __repr__(self) -> str:
        return f"MCQOption(id={self.id!r}, question_id={self.question_id!r})"
