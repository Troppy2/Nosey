from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.folder import Folder
    from src.models.kojo_message import KojoMessage
    from src.models.user import User


class KojoConversation(Base, TimestampMixin):
    __tablename__ = "kojo_conversations"
    __table_args__ = (UniqueConstraint("user_id", "folder_id", name="uq_kojo_user_folder"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    folder_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("folders.id", ondelete="CASCADE"), nullable=False, index=True
    )

    cleared_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None)

    user: Mapped[User] = relationship("User", back_populates="kojo_conversations")
    folder: Mapped[Folder] = relationship("Folder", back_populates="kojo_conversations")
    messages: Mapped[list[KojoMessage]] = relationship(
        "KojoMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="KojoMessage.created_at",
    )

    def __repr__(self) -> str:
        return f"KojoConversation(id={self.id!r}, user_id={self.user_id!r}, folder_id={self.folder_id!r})"
