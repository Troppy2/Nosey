"""091 answer_remakes

Quiz remakes (spec-quiz-remakes.md): one remake per wrong answer for half
credit, one appeal, and "Show answer" which gives the remake up. The attempt
keeps its original score; remake_score is the score with remakes (null until
the first remake).

Revision ID: 091_answer_remakes
Revises: 090_answer_feedback_sections
Create Date: 2026-11-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "091_answer_remakes"
down_revision = "090_answer_feedback_sections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_answers", sa.Column("remake_answer", sa.Text(), nullable=True))
    op.add_column("user_answers", sa.Column("remake_wrong", sa.Text(), nullable=True))
    op.add_column("user_answers", sa.Column("remake_right", sa.Text(), nullable=True))
    op.add_column("user_answers", sa.Column("remake_work_transcript", sa.Text(), nullable=True))
    op.add_column("user_answers", sa.Column("remake_status", sa.String(length=16), nullable=True))
    op.add_column("user_answers", sa.Column("remake_feedback", sa.Text(), nullable=True))
    op.add_column("user_answers", sa.Column("remake_at", sa.DateTime(), nullable=True))
    op.add_column("user_answers", sa.Column("remake_appeal", sa.Text(), nullable=True))
    op.add_column("user_answers", sa.Column("remake_appeal_status", sa.String(length=16), nullable=True))
    op.add_column(
        "user_answers",
        sa.Column("answer_revealed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("user_attempts", sa.Column("remake_score", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("user_attempts", "remake_score")
    for column in (
        "answer_revealed",
        "remake_appeal_status",
        "remake_appeal",
        "remake_at",
        "remake_feedback",
        "remake_status",
        "remake_work_transcript",
        "remake_right",
        "remake_wrong",
        "remake_answer",
    ):
        op.drop_column("user_answers", column)
