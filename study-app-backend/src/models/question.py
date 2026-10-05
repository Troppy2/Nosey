from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base

if TYPE_CHECKING:
    from src.models.frq_answer import FRQAnswer
    from src.models.mcq_option import MCQOption
    from src.models.question_group import QuestionGroup
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
    # Multi-part practice problems (GH #151): the shared setup lives on the
    # group, this row holds one part. Both None for an ordinary question.
    group_id: Mapped[Optional[int]] = mapped_column(
        BIGINT_ID, ForeignKey("question_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    part_label: Mapped[Optional[str]] = mapped_column(String(8))

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
    group: Mapped[Optional[QuestionGroup]] = relationship("QuestionGroup", back_populates="questions")

    def __repr__(self) -> str:
        return f"Question(id={self.id!r}, type={self.question_type!r})"


def full_question_text(question: Question) -> str:
    """The text an LLM needs to understand this question on its own.

    A part of a multi-part problem (GH #151) is stored without the setup it
    depends on ("(b) Find its inverse"), so every grader, explainer and
    summary gets the setup first. The group must already be loaded.
    """
    group = question.__dict__.get("group")
    if group is None or not (group.stem or "").strip():
        return question.question_text
    part = f"({question.part_label}) " if question.part_label else ""
    return f"{group.stem.strip()}\n\n{part}{question.question_text}"
