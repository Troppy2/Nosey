from __future__ import annotations

from typing import TYPE_CHECKING, Optional
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.user import User


class LCProgress(Base, TimestampMixin):
    __tablename__ = "lc_progress"
    __table_args__ = (UniqueConstraint("user_id", "problem_slug", name="uq_lc_progress_user_problem"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped[User] = relationship("User", back_populates="lc_progress")

    def __repr__(self) -> str:
        return f"LCProgress(user_id={self.user_id!r}, slug={self.problem_slug!r}, done={self.done!r})"


class LCActivityDate(Base):
    __tablename__ = "lc_activity_dates"
    __table_args__ = (UniqueConstraint("user_id", "activity_date", name="uq_lc_activity_user_date"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    activity_date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD

    user: Mapped[User] = relationship("User", back_populates="lc_activity_dates")

    def __repr__(self) -> str:
        return f"LCActivityDate(user_id={self.user_id!r}, date={self.activity_date!r})"


class LCCodeWorkspace(Base, TimestampMixin):
    __tablename__ = "lc_code_workspaces"
    __table_args__ = (UniqueConstraint("user_id", "problem_slug", name="uq_lc_workspace_user_problem"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    workspace_json: Mapped[str] = mapped_column(Text, nullable=False)

    user: Mapped[User] = relationship("User", back_populates="lc_code_workspaces")

    def __repr__(self) -> str:
        return f"LCCodeWorkspace(user_id={self.user_id!r}, slug={self.problem_slug!r})"


class LCProblemNote(Base, TimestampMixin):
    __tablename__ = "lc_problem_notes"
    __table_args__ = (UniqueConstraint("user_id", "problem_slug", name="uq_lc_note_user_problem"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    user: Mapped[User] = relationship("User", back_populates="lc_problem_notes")

    def __repr__(self) -> str:
        return f"LCProblemNote(user_id={self.user_id!r}, slug={self.problem_slug!r})"


class LCCustomProblem(Base, TimestampMixin):
    """A user-authored LeetCode-style problem. Slug is client-generated (custom-<uuid>)
    so it never collides with official slugs and the existing slug-keyed progress,
    workspace, and notes sync all work for it without any extra wiring."""

    __tablename__ = "lc_custom_problems"
    __table_args__ = (UniqueConstraint("user_id", "slug", name="uq_lc_custom_user_slug"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    topic: Mapped[str] = mapped_column(String(120), nullable=False, default="unknown")
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    starter_code: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # JSON array of {input_text, output_text, explanation_text} objects.
    test_cases_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # Soft-archive: hidden from the active list but kept (with its progress and
    # workspace) so the user can restore it later instead of losing it to a delete.
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped[User] = relationship("User", back_populates="lc_custom_problems")

    def __repr__(self) -> str:
        return f"LCCustomProblem(user_id={self.user_id!r}, slug={self.slug!r})"


class LCStreakChallenge(Base, TimestampMixin):
    """One active streak-rescue challenge per user. Created when the user's streak
    reaches zero (and they have a prior streak). Completing it before expiry
    bridges the gap in their activity dates so the streak is preserved."""

    __tablename__ = "lc_streak_challenges"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User", back_populates="lc_streak_challenges")

    def __repr__(self) -> str:
        return f"LCStreakChallenge(user_id={self.user_id!r}, slug={self.problem_slug!r})"
