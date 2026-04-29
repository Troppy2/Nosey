from __future__ import annotations

from decimal import Decimal
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base

if TYPE_CHECKING:
    from src.models.question import Question
    from src.models.user_attempt import UserAttempt


class UserAnswer(Base):
    __tablename__ = "user_answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_answer_attempt_question"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    attempt_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("user_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_answer: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[Optional[bool]] = mapped_column(Boolean)
    ai_feedback: Mapped[Optional[str]] = mapped_column(Text)
    confidence_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(3, 2))
    flagged_uncertain: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    attempt: Mapped[UserAttempt] = relationship("UserAttempt", back_populates="answers")
    question: Mapped[Question] = relationship("Question", back_populates="user_answers")

    def __repr__(self) -> str:
        return f"UserAnswer(id={self.id!r}, question_id={self.question_id!r})"
