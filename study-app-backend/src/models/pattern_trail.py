"""Pattern Trails: learn to recognize which technique a problem needs, one pattern
at a time. Content (topics > subtopics/"paths" > steps, plus the topic gate pool)
is shared by every user and written by an admin's MCP connector or a seed. The
pt_user_* / pt_redos / pt_gate_* tables hold per-user progress.

Spec: .claude/plans/specs/spec-pattern-trails.md (sections 4 and 5). The game
rules themselves live in services/pattern_trails/rules.py (pure, unit tested).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

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
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base, TimestampMixin

_USER_FK = "users.id"


# ── Shared content ────────────────────────────────────────────────────────────


class PTTopic(Base, TimestampMixin):
    """A land on the world map (e.g. Sliding window)."""

    __tablename__ = "pt_topics"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    icon_key: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)


class PTSubtopic(Base, TimestampMixin):
    """A path inside a topic, and the pattern a gate item can be. The slug is unique
    across every topic because the path page URL is /pattern-trails/:subtopicSlug."""

    __tablename__ = "pt_subtopics"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    topic_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("pt_topics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    summary: Mapped[str] = mapped_column(String(400), nullable=False, default="", server_default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Kojo lesson (the required first stop): an LCLecture slug. Lessons are made once
    # and shared through the lecture system; null until one is linked.
    lecture_slug: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # JSON list of short strings: the cues that give this pattern away.
    cues_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    template_code: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")


class PTStep(Base, TimestampMixin):
    """One stop on a path: one problem. Position 1..5, easy to hard."""

    __tablename__ = "pt_steps"
    __table_args__ = (UniqueConstraint("subtopic_id", "position", name="uq_pt_steps_subtopic_position"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    subtopic_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("pt_subtopics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="Medium")
    # Null = the default for the difficulty (rules.step_time_limit). Set to override.
    time_limit_s: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class PTGateItem(Base, TimestampMixin):
    """A problem in a topic's recognition-gate pool. The right answer is either one of
    the trail subtopics (right_subtopic_id) or, for a distractor whose pattern has no
    trail yet (prefix sum for continuous-subarray-sum), a bare pattern key + title."""

    __tablename__ = "pt_gate_items"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    topic_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("pt_topics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="Medium")
    right_subtopic_id: Mapped[Optional[int]] = mapped_column(
        BIGINT_ID, ForeignKey("pt_subtopics.id", ondelete="CASCADE"), nullable=True, index=True
    )
    right_pattern_key: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    right_pattern_title: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    # The one-line cue shown when the pick is wrong.
    cue: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # A title-free statement for when the catalog one gives the pattern away.
    statement_override: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


# ── Per-user progress ─────────────────────────────────────────────────────────


class PTUserLesson(Base):
    __tablename__ = "pt_user_lessons"
    __table_args__ = (UniqueConstraint("user_id", "subtopic_id", name="uq_pt_user_lessons"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey(_USER_FK, ondelete="CASCADE"), nullable=False, index=True
    )
    subtopic_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("pt_subtopics.id", ondelete="CASCADE"), nullable=False
    )
    watched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PTUserStep(Base, TimestampMixin):
    """A user's record on one step. "locked" is never stored: it is derived from the
    lesson and the previous step (rules.step_states)."""

    __tablename__ = "pt_user_steps"
    __table_args__ = (UniqueConstraint("user_id", "step_id", name="uq_pt_user_steps"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey(_USER_FK, ondelete="CASCADE"), nullable=False, index=True
    )
    step_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("pt_steps.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")  # open | passed
    # Pass-3 attempts (passes 1 and 2 are practice and are not counted).
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Set on the first pass-3 attempt: did that attempt pass? Feeds the solve rate.
    first_try_passed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    passed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    best_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Tests passed in time, waiting on the write-up (Kojo grades it). Cleared when the
    # write-up passes or runs out of tries.
    pending_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    writeup_tries: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class PTRedo(Base, TimestampMixin):
    """A timed redo on the 1 / 7 / 21 day schedule. One live redo per (user, problem):
    the partial unique index ignores retired rows, which are kept for history."""

    __tablename__ = "pt_redos"
    __table_args__ = (
        Index(
            "uq_pt_redos_live",
            "user_id",
            "problem_slug",
            unique=True,
            postgresql_where=text("retired_at IS NULL"),
            sqlite_where=text("retired_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey(_USER_FK, ondelete="CASCADE"), nullable=False, index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(200), nullable=False)
    # Where the redo came from: a path step, or a gate item (exactly one is set).
    step_id: Mapped[Optional[int]] = mapped_column(
        BIGINT_ID, ForeignKey("pt_steps.id", ondelete="SET NULL"), nullable=True
    )
    gate_item_id: Mapped[Optional[int]] = mapped_column(
        BIGINT_ID, ForeignKey("pt_gate_items.id", ondelete="SET NULL"), nullable=True
    )
    time_limit_s: Mapped[int] = mapped_column(Integer, nullable=False)
    interval_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # failed | slow | passed: what the last event on this problem was.
    last_result: Mapped[str] = mapped_column(String(10), nullable=False)
    retired_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PTGateAttempt(Base, TimestampMixin):
    __tablename__ = "pt_gate_attempts"
    __table_args__ = (Index("ix_pt_gate_attempts_user_topic", "user_id", "topic_id"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey(_USER_FK, ondelete="CASCADE"), nullable=False
    )
    topic_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("pt_topics.id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # Set on a failed attempt: no new draw before this.
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PTGateAnswer(Base, TimestampMixin):
    """One drawn item in an attempt. Rows are written when the attempt starts, so they
    also hold the draw; the pick and the solve fill in later."""

    __tablename__ = "pt_gate_answers"
    __table_args__ = (UniqueConstraint("attempt_id", "item_id", name="uq_pt_gate_answers_item"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    attempt_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("pt_gate_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("pt_gate_items.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    picked_key: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    correct: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    reason_text: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    kojo_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    solved: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
