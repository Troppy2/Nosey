from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base

if TYPE_CHECKING:
    from src.models.kojo_conversation import KojoConversation


class KojoActionCard(Base):
    """A chat-embedded action proposal (create folder/flashcards/module, start matching).

    Persisted so cards survive a reload, and so confirmed cards double as the
    "created artifacts" half of the chat's documents panel. payload_json holds
    the LLM-extracted fields (title/topic/count/etc) and, after confirm, the
    created entity's id/title.
    """

    __tablename__ = "kojo_action_cards"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("kojo_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Anchors the card to a position in the message stream (the user message
    # that triggered it). Nullable: the message may have been cleared.
    message_id: Mapped[Optional[int]] = mapped_column(
        BIGINT_ID, ForeignKey("kojo_messages.id", ondelete="SET NULL"), nullable=True
    )
    action_type: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="proposed")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    # After confirm: what got created, so the docs panel can link out and a
    # staleness check can detect the entity being deleted later.
    entity_type: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    entity_id: Mapped[Optional[int]] = mapped_column(BIGINT_ID, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None)

    conversation: Mapped[KojoConversation] = relationship(
        "KojoConversation", back_populates="action_cards"
    )

    def __repr__(self) -> str:
        return (
            f"KojoActionCard(id={self.id!r}, conversation_id={self.conversation_id!r}, "
            f"action_type={self.action_type!r}, status={self.status!r})"
        )
