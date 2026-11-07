"""080 mock_resume_questions

Question pool a connected app writes for the resume deep dive, plus the 5 picked,
and the saved transcripts of every voice round.

Revision ID: 080_mock_resume_questions
Revises: 079_study_plans
Create Date: 2026-11-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "080_mock_resume_questions"
down_revision = "079_study_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mock_interview_sessions", sa.Column("resume_questions", sa.Text(), nullable=True))
    op.add_column("mock_interview_sessions", sa.Column("transcripts", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("mock_interview_sessions", "transcripts")
    op.drop_column("mock_interview_sessions", "resume_questions")
