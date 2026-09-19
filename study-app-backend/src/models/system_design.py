from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.user import User


class SDConceptProgress(Base, TimestampMixin):
    """Per-user completion state for one System Design concept.

    There is no concept table: the content is bundled with the frontend, so
    concept_id is an opaque string the client sends (shape-validated only). A
    concept counts as complete when all five sub-modules are done, which is what
    completed_at records.
    """

    __tablename__ = "sd_concept_progress"
    __table_args__ = (
        UniqueConstraint("user_id", "concept_id", name="uq_sd_progress_user_concept"),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    concept_id: Mapped[str] = mapped_column(String(80), nullable=False)

    notes_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    video_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    visualizer_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    project_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    quiz_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # Best combined MCQ+FRQ score, 0..100. NULL until the first graded attempt.
    quiz_best_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User", back_populates="sd_concept_progress")

    def __repr__(self) -> str:
        return f"SDConceptProgress(user_id={self.user_id!r}, concept_id={self.concept_id!r})"


class SDSubmission(Base, TimestampMixin):
    """Autosave plus last-run result for one exercise (visualizer or project).

    exercise_id is "<conceptId>:<visualizer|project>". Code runs entirely in the
    browser under Pyodide, so this row holds what the learner typed and whether
    the hidden tests passed, never anything the server executed.
    """

    __tablename__ = "sd_submissions"
    __table_args__ = (
        UniqueConstraint("user_id", "exercise_id", name="uq_sd_submission_user_exercise"),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exercise_id: Mapped[str] = mapped_column(String(120), nullable=False)

    # JSON object of {filename: contents}.
    files_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    last_run_passed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # Stamped on the first pass and never moved again, so a later failing run
    # cannot take away a completion the learner already earned.
    passed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User", back_populates="sd_submissions")

    def __repr__(self) -> str:
        return f"SDSubmission(user_id={self.user_id!r}, exercise_id={self.exercise_id!r})"


class SDQuizAttempt(Base, TimestampMixin):
    """One graded quiz submission. Append-only history: the durable flag is
    quiz_done on the progress row, and quiz_best_score its best total_score."""

    __tablename__ = "sd_quiz_attempts"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    concept_id: Mapped[str] = mapped_column(String(80), nullable=False)

    # [{id, chosenIndex, correct}]
    mcq_answers_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    # [{id, answer}]
    frq_answers_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    # [{id, is_correct, feedback, confidence, flagged_uncertain}]
    frq_grades_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")

    mcq_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    frq_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    passed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    user: Mapped[User] = relationship("User", back_populates="sd_quiz_attempts")

    def __repr__(self) -> str:
        return f"SDQuizAttempt(user_id={self.user_id!r}, concept_id={self.concept_id!r}, score={self.total_score!r})"


Index("ix_sd_quiz_attempts_user_concept", SDQuizAttempt.user_id, SDQuizAttempt.concept_id)
