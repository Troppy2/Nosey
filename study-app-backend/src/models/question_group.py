from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base

if TYPE_CHECKING:
    from src.models.question import Question


class QuestionGroup(Base):
    """A multi-part problem from a practice upload (GH #151).

    The setup shared by parts (a), (b), ... is stored once here; each part is
    an ordinary Question pointing at it, graded on its own. Every LLM call
    that sees one part gets the setup too (see full_question_text).
    """

    __tablename__ = "question_groups"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    test_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("tests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The problem's own number or name, e.g. "3" or "1.2".
    label: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    stem: Mapped[str] = mapped_column(Text, nullable=False, default="")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    questions: Mapped[list[Question]] = relationship(
        "Question", back_populates="group", order_by="Question.display_order"
    )

    def __repr__(self) -> str:
        return f"QuestionGroup(id={self.id!r}, label={self.label!r})"
