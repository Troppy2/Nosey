from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.folder import Folder
    from src.models.user import User


class Flashcard(Base, TimestampMixin):
    __tablename__ = "flashcards"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    folder_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("folders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    front: Mapped[str] = mapped_column(Text, nullable=False)
    back: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[Optional[str]] = mapped_column(String(50))
    difficulty: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    folder: Mapped[Folder] = relationship("Folder", back_populates="flashcards")
    attempts: Mapped[list[FlashcardAttempt]] = relationship(
        "FlashcardAttempt", back_populates="flashcard", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"Flashcard(id={self.id!r}, folder_id={self.folder_id!r})"


class FlashcardAttempt(Base, TimestampMixin):
    __tablename__ = "flashcard_attempts"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    flashcard_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("flashcards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    time_ms: Mapped[Optional[int]] = mapped_column(Integer)
    attempt_number: Mapped[Optional[int]] = mapped_column(Integer)

    user: Mapped[User] = relationship("User", back_populates="flashcard_attempts")
    flashcard: Mapped[Flashcard] = relationship("Flashcard", back_populates="attempts")

    def __repr__(self) -> str:
        return f"FlashcardAttempt(id={self.id!r}, flashcard_id={self.flashcard_id!r})"
