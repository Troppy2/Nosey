from __future__ import annotations

from typing import Optional

from sqlalchemy import BigInteger, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base, TimestampMixin


class UsageEvent(Base, TimestampMixin):
    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), nullable=False, index=True)
    feature: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    def __repr__(self) -> str:
        return f"UsageEvent(id={self.id!r}, user_id={self.user_id!r}, feature={self.feature!r}, duration_ms={self.duration_ms!r})"
