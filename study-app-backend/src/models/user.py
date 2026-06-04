from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.flashcard import Flashcard, FlashcardAttempt
    from src.models.folder import Folder
    from src.models.kojo_conversation import KojoConversation
    from src.models.lc_sync import LCActivityDate, LCCodeWorkspace, LCProgress, LCProblemNote
    from src.models.mock_interview import MockInterviewSession
    from src.models.slash_command import SlashCommand
    from src.models.user_attempt import UserAttempt


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    google_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[Optional[str]] = mapped_column(String(255))
    profile_picture_url: Mapped[Optional[str]] = mapped_column(Text)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    admin_session_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

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
    slash_commands: Mapped[list[SlashCommand]] = relationship(
        "SlashCommand", back_populates="user", cascade="all, delete-orphan"
    )
    lc_progress: Mapped[list[LCProgress]] = relationship(
        "LCProgress", back_populates="user", cascade="all, delete-orphan"
    )
    lc_activity_dates: Mapped[list[LCActivityDate]] = relationship(
        "LCActivityDate", back_populates="user", cascade="all, delete-orphan"
    )
    lc_code_workspaces: Mapped[list[LCCodeWorkspace]] = relationship(
        "LCCodeWorkspace", back_populates="user", cascade="all, delete-orphan"
    )
    lc_problem_notes: Mapped[list[LCProblemNote]] = relationship(
        "LCProblemNote", back_populates="user", cascade="all, delete-orphan"
    )
    mock_interview_sessions: Mapped[list[MockInterviewSession]] = relationship(
        "MockInterviewSession", back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def flashcards(self) -> list[Flashcard]:
        return [card for folder in self.folders for card in folder.flashcards]

    def __repr__(self) -> str:
        return f"User(id={self.id!r}, email={self.email!r})"
