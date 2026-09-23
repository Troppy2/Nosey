from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base
from src.utils.time import utcnow_naive


class QuotaCharge(Base):
    """A count-based usage charge (tests, flashcards) inside the rolling window.

    Kept separate from Test/Flashcard rows so deleting content never hands
    quota back, and so a charge can be refunded when generation fails.
    """

    __tablename__ = "quota_charges"
    __table_args__ = (
        Index("ix_quota_charges_user_feature_created", "user_id", "feature", "created_at"),
        Index("ix_quota_charges_device_feature_created", "device_id", "feature", "created_at"),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), nullable=False)
    feature: Mapped[str] = mapped_column(String(30), nullable=False)
    # Browser device id (X-Device-Id); only set for usage-limited users.
    device_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    units: Mapped[int] = mapped_column(Integer, nullable=False)
    ref_id: Mapped[Optional[int]] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), nullable=True)
    refunded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow_naive)
