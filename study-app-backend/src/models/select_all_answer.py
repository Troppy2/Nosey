"""Select-all question answer model (multiple correct options from a list)."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base

if TYPE_CHECKING:
    from src.models.question import Question


class SelectAllAnswer(Base):
    """Correct answer for a select-all question.
    
    Stores which options are correct (the set of correct option indices or texts).
    Uses options table but with multiple correct answers rather than exactly one.
    Stored as JSON array of indices or texts.
    """
    __tablename__ = "select_all_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), unique=True)
    
    # JSON: [0, 2, 3]  — indices of correct options
    # or JSON: ["option_text_1", "option_text_3", "option_text_4"]
    # Stored as string; caller must serialize/deserialize
    correct_indices_json: Mapped[str]

    question: Mapped["Question"] = relationship(
        back_populates="select_all_answer",
        uselist=False,
    )

    def __repr__(self) -> str:
        return f"<SelectAllAnswer question_id={self.question_id}>"
