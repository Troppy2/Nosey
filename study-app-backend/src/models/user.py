from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.flashcard import Flashcard, FlashcardAttempt
    from src.models.folder import Folder
    from src.models.kojo_conversation import KojoConversation
    from src.models.user_attempt import UserAttempt


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    google_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[Optional[str]] = mapped_column(String(255))
    profile_picture_url: Mapped[Optional[str]] = mapped_column(Text)

    folders: Mapped[list[Folder]] = relationship(
        "Folder", back_populates="user", cascade="all, delete-orphan"
    )
    user_attempts: Mapped[list[UserAttempt]] = relationship(
        "UserAttempt", back_populates="user", cascade="all, delete-orphan"
    )
    flashcard_attempts: Mapped[list[FlashcardAttempt]] = relationship(
        "FlashcardAttempt", back_populates="user", cascade="all, delete-orphan"
    )
    kojo_conversations: Mapped[list[KojoConversation]] = relationship(
        "KojoConversation", back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def flashcards(self) -> list[Flashcard]:
        return [card for folder in self.folders for card in folder.flashcards]

    def __repr__(self) -> str:
        return f"User(id={self.id!r}, email={self.email!r})"
