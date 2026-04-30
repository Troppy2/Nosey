from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.flashcard import Flashcard
    from src.models.folder_file import FolderFile
    from src.models.kojo_conversation import KojoConversation
    from src.models.test import Test
    from src.models.user import User


class Folder(Base, TimestampMixin):
    __tablename__ = "folders"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_folders_user_name"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[Optional[str]] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text)

    user: Mapped[User] = relationship("User", back_populates="folders")
    tests: Mapped[list[Test]] = relationship(
        "Test", back_populates="folder", cascade="all, delete-orphan"
    )
    flashcards: Mapped[list[Flashcard]] = relationship(
        "Flashcard", back_populates="folder", cascade="all, delete-orphan"
    )
    kojo_conversations: Mapped[list[KojoConversation]] = relationship(
        "KojoConversation", back_populates="folder", cascade="all, delete-orphan"
    )
    files: Mapped[list[FolderFile]] = relationship(
        "FolderFile", back_populates="folder", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"Folder(id={self.id!r}, name={self.name!r})"
