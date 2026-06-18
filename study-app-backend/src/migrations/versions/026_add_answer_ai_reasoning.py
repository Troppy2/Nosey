"""026 add ai_reasoning column to user_answers

Stores the grader model's step-by-step working separately from the clean
feedback so the frontend can hide it behind a collapsible "Reasoning" dropdown.

Revision ID: 026_answer_ai_reasoning
Revises: 025_lc_streak_challenge
Create Date: 2026-06-17
"""
import sqlalchemy as sa
from alembic import op

revision = "026_answer_ai_reasoning"
down_revision = "025_lc_streak_challenge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_answers", sa.Column("ai_reasoning", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_answers", "ai_reasoning")
