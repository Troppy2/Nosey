from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text
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
