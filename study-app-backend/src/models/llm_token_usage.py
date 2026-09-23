from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base
from src.utils.time import utcnow_naive


class LLMTokenUsage(Base):
    """One row per provider HTTP call. Written by utils.usage_context.record_llm_usage.

    created_at is set in Python (naive UTC) rather than by the server's now(), so
    rolling-window queries compare like with like regardless of the DB timezone.
    """

    __tablename__ = "llm_token_usage"
    __table_args__ = (
        Index("ix_llm_token_usage_user_feature_created", "user_id", "feature", "created_at"),
        Index("ix_llm_token_usage_device_feature_created", "device_id", "feature", "created_at"),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), nullable=True)
    feature: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # Browser device id (X-Device-Id); only set for usage-limited users.
    device_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow_naive)
