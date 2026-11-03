from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.user import User


class StudyPlan(Base, TimestampMixin):
    __tablename__ = "study_plans"
    __table_args__ = (
        Index("ix_study_plans_user_pinned", "user_id", "is_pinned"),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    exam_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="study_plans")
    items: Mapped[list[StudyPlanItem]] = relationship(
        "StudyPlanItem",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="StudyPlanItem.position",
    )

    def __repr__(self) -> str:
        return f"StudyPlan(id={self.id!r}, user_id={self.user_id!r}, title={self.title!r})"


class StudyPlanItem(Base, TimestampMixin):
    __tablename__ = "study_plan_items"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    plan_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("study_plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    target_id: Mapped[Optional[int]] = mapped_column(BIGINT_ID, nullable=True)
    target_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    done_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    done_source: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    plan: Mapped[StudyPlan] = relationship("StudyPlan", back_populates="items")

    def __repr__(self) -> str:
        return f"StudyPlanItem(id={self.id!r}, plan_id={self.plan_id!r}, kind={self.kind!r}, done={self.done!r})"
