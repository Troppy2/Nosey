"""055 add System Design mode tables

Three user-state tables for the beta-only System Design track. There is no
content table on purpose: concepts, exercises, hidden tests and quizzes are
bundled with the frontend, so concept_id and exercise_id are opaque strings the
client sends and the server only shape-validates.

- sd_concept_progress: the five sub-module booleans per concept, the best quiz
  score, and completed_at (set only while all five are done).
- sd_submissions: autosave plus last-run result for one exercise. Code runs in
  the browser under Pyodide, never here.
- sd_quiz_attempts: append-only graded attempts. The durable pass flag lives on
  the progress row, so this table is history and carries no unique constraint.

Revision ID: 055_add_system_design_mode
Revises: 054_add_preferred_name
Create Date: 2026-09-18
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "055_add_system_design_mode"
down_revision = "054_add_preferred_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sd_concept_progress",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("concept_id", sa.String(80), nullable=False),
        sa.Column("notes_done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("video_done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("visualizer_done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("project_done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("quiz_done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("quiz_best_score", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "concept_id", name="uq_sd_progress_user_concept"),
    )
    op.create_index("ix_sd_concept_progress_user_id", "sd_concept_progress", ["user_id"])

    op.create_table(
        "sd_submissions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("exercise_id", sa.String(120), nullable=False),
        sa.Column("files_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("last_run_passed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("passed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "exercise_id", name="uq_sd_submission_user_exercise"),
    )
    op.create_index("ix_sd_submissions_user_id", "sd_submissions", ["user_id"])

    op.create_table(
        "sd_quiz_attempts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("concept_id", sa.String(80), nullable=False),
        sa.Column("mcq_answers_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("frq_answers_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("frq_grades_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("mcq_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("frq_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sd_quiz_attempts_user_id", "sd_quiz_attempts", ["user_id"])
    op.create_index(
        "ix_sd_quiz_attempts_user_concept", "sd_quiz_attempts", ["user_id", "concept_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_sd_quiz_attempts_user_concept", table_name="sd_quiz_attempts")
    op.drop_index("ix_sd_quiz_attempts_user_id", table_name="sd_quiz_attempts")
    op.drop_table("sd_quiz_attempts")

    op.drop_index("ix_sd_submissions_user_id", table_name="sd_submissions")
    op.drop_table("sd_submissions")

    op.drop_index("ix_sd_concept_progress_user_id", table_name="sd_concept_progress")
    op.drop_table("sd_concept_progress")
