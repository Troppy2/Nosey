from __future__ import annotations

from typing import TYPE_CHECKING, Optional
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
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
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_lc_custom_user_slug"),
        # At most one Daily KojoCode problem per user per calendar day. Partial so it
        # never constrains ordinary user-authored rows (their daily_date is NULL).
        Index(
            "uq_lc_custom_daily_per_user",
            "user_id",
            "daily_date",
            unique=True,
            postgresql_where=text("source = 'daily_kojo'"),
            sqlite_where=text("source = 'daily_kojo'"),
        ),
    )

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
    # 'user' for a user-authored problem, 'daily_kojo' for a generated Daily KojoCode
    # problem. daily_date (YYYY-MM-DD) is the calendar day a daily problem is for and
    # is NULL for everything else; together they drive the one-per-day partial index.
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="user", server_default="user")
    daily_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

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


class LCStruggleEvent(Base):
    """A single struggle signal (timer expiry, hint used, or failed grade). The
    weakness scorer aggregates the last few days of these directly, so there is no
    rollup table. Topic is a client-sent category id string (the backend owns no
    problem catalog to derive it from)."""

    __tablename__ = "lc_struggle_events"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    topic: Mapped[str] = mapped_column(String(120), nullable=False)
    # timer_expiry | hint_used | failed_grade
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Nullable: only needed so the failed_grade/timer_expiry auto-add-drill hook
    # (step 7) has a problem to key the new drill row on.
    problem_slug: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship("User", back_populates="lc_struggle_events")

    def __repr__(self) -> str:
        return f"LCStruggleEvent(user_id={self.user_id!r}, topic={self.topic!r}, type={self.event_type!r})"


class LCPrepBank(Base, TimestampMixin):
    """A user-curated bank of problems for a prep target (e.g. a company onsite).
    Only one bank per user is active at a time; that invariant lives in the service
    layer (query-then-deactivate), not in a DB constraint, mirroring how the one
    active streak challenge is enforced."""

    __tablename__ = "lc_prep_banks"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    target: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped[User] = relationship("User", back_populates="lc_prep_banks")
    problems: Mapped[list[LCBankProblem]] = relationship(
        "LCBankProblem", back_populates="bank", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"LCPrepBank(user_id={self.user_id!r}, name={self.name!r}, active={self.is_active!r})"


class LCBankProblem(Base):
    """A problem slug held in a prep bank. Works uniformly for catalog slugs and
    custom-* slugs, so there is no FK to a problems table (there isn't one)."""

    __tablename__ = "lc_bank_problems"
    __table_args__ = (UniqueConstraint("bank_id", "problem_slug", name="uq_lc_bank_problem"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    bank_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("lc_prep_banks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    bank: Mapped[LCPrepBank] = relationship("LCPrepBank", back_populates="problems")

    def __repr__(self) -> str:
        return f"LCBankProblem(bank_id={self.bank_id!r}, slug={self.problem_slug!r})"


class LCDrillSchedule(Base, TimestampMixin):
    """A spaced-repetition drill: one problem worked through up to three passes with
    expanding intervals (min 24h between passes). completed_at is set once pass 3
    clears; the row is kept after that for history and streak/heatmap credit rather
    than deleted."""

    __tablename__ = "lc_drill_schedule"
    __table_args__ = (UniqueConstraint("user_id", "problem_slug", name="uq_lc_drill_user_problem"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    current_pass: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    next_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # auto (created from a struggle signal) | manual (user added it)
    added_from: Mapped[str] = mapped_column(String(10), nullable=False, default="auto")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User", back_populates="lc_drill_schedule")

    def __repr__(self) -> str:
        return f"LCDrillSchedule(user_id={self.user_id!r}, slug={self.problem_slug!r}, pass={self.current_pass!r})"
