"""Fill-in-the-blank question answer model (one or more correct answers)."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base

if TYPE_CHECKING:
    from src.models.question import Question


class FillBlankAnswer(Base):
    """Correct answer for a fill-in-the-blank question.
    
    Stores one or more acceptable answers (for case-insensitive matching or synonyms).
    Stored as JSON array of strings.
    """
    __tablename__ = "fill_blank_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), unique=True)
    
    # JSON: ["correct_answer1", "acceptable_synonym", "another_valid_answer"]
    # Stored as string; caller must serialize/deserialize
    # For matching, comparisons should be case-insensitive
    acceptable_answers_json: Mapped[str]

    question: Mapped["Question"] = relationship(
        back_populates="fill_blank_answer",
        uselist=False,
    )

    def __repr__(self) -> str:
        return f"<FillBlankAnswer question_id={self.question_id}>"
