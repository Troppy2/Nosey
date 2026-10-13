"""Account safety: tombstones for deleted or banned accounts, and moderation flags.

GH #172 (re-sign-up cooldown) and GH #173 (bans and moderation).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base
from src.utils.time import utcnow_naive


class AccountTombstone(Base):
    """A Google account that may not create a new Nosey account yet (or ever).

    Holds only an HMAC of the Google subject id, never the raw id or email.
    reason "deleted" expires after the cooldown; reason "banned" has no expiry,
    so deleting a banned account cannot be used to come back.
    """

    __tablename__ = "account_tombstones"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    subject_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow_naive)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ContentFlag(Base):
    """One moderation hit on something a user typed, kept for admin review."""

    __tablename__ = "content_flags"
    __table_args__ = (
        Index("ix_content_flags_user_created", "user_id", "created_at"),
        Index("ix_content_flags_unreviewed", "reviewed_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Where the text came from, e.g. "kojo_chat", "learning_track", "flashcards".
    feature: Mapped[str] = mapped_column(String(40), nullable=False)
    # "minors" | "harmful" | "self_harm"; drives what the user was shown.
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    # The OpenAI categories that fired, comma separated, and the top score.
    categories: Mapped[str] = mapped_column(String(255), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # The flagged text (capped), so an admin can judge it in context.
    excerpt: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow_naive)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reviewed_by: Mapped[Optional[int]] = mapped_column(BIGINT_ID, nullable=True)
    # "dismissed" | "banned" once reviewed; "auto_banned" for minors hits.
    action: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
