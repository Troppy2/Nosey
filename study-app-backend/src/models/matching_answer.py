"""Matching question answer model (pairs of left/right items to match)."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base

if TYPE_CHECKING:
    from src.models.question import Question


class MatchingAnswer(Base):
    """Correct answer for a matching question.
    
    Stores pairs of items (left: left_item, right: right_item) that students must match.
    Stored as JSON string to support flexible pair structures.
    """
    __tablename__ = "matching_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), unique=True)
    
    # JSON: [{"left": "term1", "right": "def1"}, {"left": "term2", "right": "def2"}]
    # Stored as string; caller must serialize/deserialize
    pairs_json: Mapped[str]

    question: Mapped["Question"] = relationship(
        back_populates="matching_answer",
        uselist=False,
    )

    def __repr__(self) -> str:
        return f"<MatchingAnswer question_id={self.question_id}>"
