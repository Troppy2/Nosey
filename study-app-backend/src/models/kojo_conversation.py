from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.conversation_file import ConversationFile
    from src.models.folder import Folder
    from src.models.kojo_message import KojoMessage
    from src.models.user import User


class KojoConversation(Base, TimestampMixin):
    __tablename__ = "kojo_conversations"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    folder_id: Mapped[Optional[int]] = mapped_column(
        BIGINT_ID, ForeignKey("folders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, default=None)

    cleared_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None)

    user: Mapped[User] = relationship("User", back_populates="kojo_conversations")
    folder: Mapped[Optional[Folder]] = relationship("Folder", back_populates="kojo_conversations")
    messages: Mapped[list[KojoMessage]] = relationship(
        "KojoMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="KojoMessage.created_at",
    )
    conversation_files: Mapped[list[ConversationFile]] = relationship(
        "ConversationFile",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ConversationFile.uploaded_at",
    )

    def __repr__(self) -> str:
        return f"KojoConversation(id={self.id!r}, user_id={self.user_id!r}, folder_id={self.folder_id!r})"
