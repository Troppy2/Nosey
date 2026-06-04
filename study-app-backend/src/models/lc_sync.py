from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
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
