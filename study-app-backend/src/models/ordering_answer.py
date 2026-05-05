"""Ordering question answer model (correct sequence of items)."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base

if TYPE_CHECKING:
    from src.models.question import Question


class OrderingAnswer(Base):
    """Correct answer for an ordering question.
    
    Stores the correct sequence of items that students must arrange.
    Stored as JSON array to maintain order.
    """
    __tablename__ = "ordering_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), unique=True)
    
    # JSON: ["item1", "item2", "item3"]
    # Stored as string; caller must serialize/deserialize
    correct_order_json: Mapped[str]

    question: Mapped["Question"] = relationship(
        back_populates="ordering_answer",
        uselist=False,
    )

    def __repr__(self) -> str:
        return f"<OrderingAnswer question_id={self.question_id}>"
