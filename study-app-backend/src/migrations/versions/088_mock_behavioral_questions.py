"""088 mock_behavioral_questions

Question pool a connected app writes for the behavioral round (stage 3), plus the
5 picked. Same JSON shape as resume_questions (080).

Revision ID: 088_mock_behavioral_questions
Revises: 087_audio_last_used_at
Create Date: 2026-11-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "088_mock_behavioral_questions"
down_revision = "087_audio_last_used_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mock_interview_sessions", sa.Column("behavioral_questions", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("mock_interview_sessions", "behavioral_questions")
