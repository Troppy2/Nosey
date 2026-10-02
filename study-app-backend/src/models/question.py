from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base

if TYPE_CHECKING:
    from src.models.frq_answer import FRQAnswer
    from src.models.mcq_option import MCQOption
    from src.models.test import Test
    from src.models.user_answer import UserAnswer


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    test_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("tests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(10), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # Recreated practice tests: the document had no answer for this question,
    # so the model worked it out. Results labels it; written grading treats the
    # reference answer as a guide (GH #133).
    answer_inferred: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    test: Mapped[Test] = relationship("Test", back_populates="questions")
    mcq_options: Mapped[list[MCQOption]] = relationship(
        "MCQOption",
        back_populates="question",
        cascade="all, delete-orphan",
        order_by="MCQOption.display_order",
    )
    frq_answer: Mapped[Optional[FRQAnswer]] = relationship(
        "FRQAnswer", back_populates="question", cascade="all, delete-orphan", uselist=False
    )
    user_answers: Mapped[list[UserAnswer]] = relationship(
        "UserAnswer", back_populates="question", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"Question(id={self.id!r}, type={self.question_type!r})"
