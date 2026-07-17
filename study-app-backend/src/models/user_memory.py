from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base, TimestampMixin


class UserMemory(Base, TimestampMixin):
    """One weekly-recap memory per user.

    A short, server-generated summary of what the student has been studying
    (folders, tests, flashcards, chat topics) over the past week. Regenerated on
    demand when it goes stale, shown in Settings, and fed into Kojo's prompt so
    it can personalize answers. One row per user (user_id is unique).
    """

    __tablename__ = "user_memories"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
