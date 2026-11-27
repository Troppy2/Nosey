"""092 pattern_trails

Pattern Trails (spec: .claude/plans/specs/spec-pattern-trails.md). Shared content
tables (pt_topics, pt_subtopics, pt_steps, pt_gate_items) and per-user progress
(pt_user_lessons, pt_user_steps, pt_redos, pt_gate_attempts, pt_gate_answers).
pt_redos keeps one live redo per (user, problem) with a partial unique index.

Revision ID: 092_pattern_trails
Revises: 091_answer_remakes
Create Date: 2026-11-25
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "092_pattern_trails"
down_revision = "091_answer_remakes"
branch_labels = None
depends_on = None

_ID = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _id() -> sa.Column:
    return sa.Column("id", _ID, primary_key=True, autoincrement=True)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    ]


def _user_id() -> sa.Column:
    return sa.Column("user_id", _ID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "pt_topics",
        _id(),
        sa.Column("slug", sa.String(120), nullable=False, unique=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("icon_key", sa.String(60), nullable=True),
        *_timestamps(),
    )
    op.create_table(
        "pt_subtopics",
        _id(),
        sa.Column("topic_id", _ID, sa.ForeignKey("pt_topics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False, unique=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("summary", sa.String(400), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lecture_slug", sa.String(120), nullable=True),
        sa.Column("cues_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("template_code", sa.Text(), nullable=False, server_default=""),
        *_timestamps(),
    )
    op.create_index("ix_pt_subtopics_topic_id", "pt_subtopics", ["topic_id"])
    op.create_table(
        "pt_steps",
        _id(),
        sa.Column("subtopic_id", _ID, sa.ForeignKey("pt_subtopics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("difficulty", sa.String(20), nullable=False),
        sa.Column("time_limit_s", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("subtopic_id", "position", name="uq_pt_steps_subtopic_position"),
    )
    op.create_index("ix_pt_steps_subtopic_id", "pt_steps", ["subtopic_id"])
    op.create_table(
        "pt_gate_items",
        _id(),
        sa.Column("topic_id", _ID, sa.ForeignKey("pt_topics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("difficulty", sa.String(20), nullable=False),
        sa.Column(
            "right_subtopic_id", _ID, sa.ForeignKey("pt_subtopics.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("right_pattern_key", sa.String(120), nullable=True),
        sa.Column("right_pattern_title", sa.String(160), nullable=True),
        sa.Column("cue", sa.Text(), nullable=False, server_default=""),
        sa.Column("statement_override", sa.Text(), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_pt_gate_items_topic_id", "pt_gate_items", ["topic_id"])
    op.create_index("ix_pt_gate_items_right_subtopic_id", "pt_gate_items", ["right_subtopic_id"])

    op.create_table(
        "pt_user_lessons",
        _id(),
        _user_id(),
        sa.Column("subtopic_id", _ID, sa.ForeignKey("pt_subtopics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("watched_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "subtopic_id", name="uq_pt_user_lessons"),
    )
    op.create_index("ix_pt_user_lessons_user_id", "pt_user_lessons", ["user_id"])
    op.create_table(
        "pt_user_steps",
        _id(),
        _user_id(),
        sa.Column("step_id", _ID, sa.ForeignKey("pt_steps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("first_try_passed", sa.Boolean(), nullable=True),
        sa.Column("passed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("best_seconds", sa.Integer(), nullable=True),
        sa.Column("pending_seconds", sa.Integer(), nullable=True),
        sa.Column("writeup_tries", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.UniqueConstraint("user_id", "step_id", name="uq_pt_user_steps"),
    )
    op.create_index("ix_pt_user_steps_user_id", "pt_user_steps", ["user_id"])
    op.create_table(
        "pt_redos",
        _id(),
        _user_id(),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("step_id", _ID, sa.ForeignKey("pt_steps.id", ondelete="SET NULL"), nullable=True),
        sa.Column("gate_item_id", _ID, sa.ForeignKey("pt_gate_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("time_limit_s", sa.Integer(), nullable=False),
        sa.Column("interval_index", sa.Integer(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_result", sa.String(10), nullable=False),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_pt_redos_user_id", "pt_redos", ["user_id"])
    op.create_index(
        "uq_pt_redos_live",
        "pt_redos",
        ["user_id", "problem_slug"],
        unique=True,
        postgresql_where=sa.text("retired_at IS NULL"),
        sqlite_where=sa.text("retired_at IS NULL"),
    )
    op.create_table(
        "pt_gate_attempts",
        _id(),
        _user_id(),
        sa.Column("topic_id", _ID, sa.ForeignKey("pt_topics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_pt_gate_attempts_user_topic", "pt_gate_attempts", ["user_id", "topic_id"])
    op.create_table(
        "pt_gate_answers",
        _id(),
        sa.Column(
            "attempt_id", _ID, sa.ForeignKey("pt_gate_attempts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("item_id", _ID, sa.ForeignKey("pt_gate_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("picked_key", sa.String(120), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("reason_text", sa.String(200), nullable=True),
        sa.Column("kojo_note", sa.Text(), nullable=True),
        sa.Column("solved", sa.Boolean(), nullable=True),
        sa.Column("seconds", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("attempt_id", "item_id", name="uq_pt_gate_answers_item"),
    )
    op.create_index("ix_pt_gate_answers_attempt_id", "pt_gate_answers", ["attempt_id"])


def downgrade() -> None:
    op.drop_table("pt_gate_answers")
    op.drop_table("pt_gate_attempts")
    op.drop_index("uq_pt_redos_live", table_name="pt_redos")
    op.drop_table("pt_redos")
    op.drop_table("pt_user_steps")
    op.drop_table("pt_user_lessons")
    op.drop_table("pt_gate_items")
    op.drop_table("pt_steps")
    op.drop_table("pt_subtopics")
    op.drop_table("pt_topics")
