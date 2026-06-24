from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.folder import Folder
    from src.models.note import Note
    from src.models.question import Question
    from src.models.user_attempt import UserAttempt


class Test(Base, TimestampMixin):
    __tablename__ = "tests"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    folder_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("folders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    test_type: Mapped[str] = mapped_column(String(50), nullable=False)
    is_math_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_coding_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    coding_language: Mapped[Optional[str]] = mapped_column(String(50))
    generation_status: Mapped[str] = mapped_column(String(20), nullable=False, default="ready", server_default="ready")
    generation_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Total number of questions this test is expected to contain once generation finishes.
    # Set at create time so the take-test screen can show streaming progress ("12 of 100
    # generated so far") while questions are still being written in the background.
    expected_question_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # SHA-256 of the source notes used to generate this test. Lets a later test built
    # from the SAME notes find and avoid repeating these questions ("fresh questions").
    notes_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    folder: Mapped[Folder] = relationship("Folder", back_populates="tests")
    questions: Mapped[list[Question]] = relationship(
        "Question",
        back_populates="test",
        cascade="all, delete-orphan",
        order_by="Question.display_order",
    )
    notes: Mapped[list[Note]] = relationship("Note", back_populates="test", cascade="all, delete-orphan")
    attempts: Mapped[list[UserAttempt]] = relationship(
        "UserAttempt", back_populates="test", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"Test(id={self.id!r}, title={self.title!r})"
