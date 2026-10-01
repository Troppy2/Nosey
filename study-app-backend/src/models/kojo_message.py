from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.kojo_conversation import KojoConversation


class KojoMessage(Base, TimestampMixin):
    __tablename__ = "kojo_messages"
    __table_args__ = (
        # get_history() filters by conversation_id and orders by created_at DESC.
        # The plain conversation_id index forces a re-sort; this composite lets
        # the DB walk the index in order and apply LIMIT without sorting.
        Index("ix_kojo_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("kojo_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Tutor ladder state (GH #108, see services/kojo_tutor.py). Set on assistant
    # rows of study-chat turns; NULL elsewhere.
    tutor_intent: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    tutor_subtype: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    tutor_step: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    tutor_problem: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

    conversation: Mapped[KojoConversation] = relationship("KojoConversation", back_populates="messages")

    def __repr__(self) -> str:
        return f"KojoMessage(id={self.id!r}, role={self.role!r})"
