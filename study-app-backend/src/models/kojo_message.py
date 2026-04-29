from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.kojo_conversation import KojoConversation


class KojoMessage(Base, TimestampMixin):
    __tablename__ = "kojo_messages"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("kojo_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    conversation: Mapped[KojoConversation] = relationship("KojoConversation", back_populates="messages")

    def __repr__(self) -> str:
        return f"KojoMessage(id={self.id!r}, role={self.role!r})"
