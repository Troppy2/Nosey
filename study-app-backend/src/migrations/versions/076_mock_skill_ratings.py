"""076 skill_ratings on mock_interview_sessions

The loop debrief now rates each skill (coding, problem solving, communication,
testing) on the six-step hiring-committee scale, alongside the final call. Stored
as JSON {"call": "...", "skills": {...}}. Existing rows stay NULL and keep their
old four-step recommendation, read from overall_feedback as before.

Revision ID: 076_mock_skill_ratings
Revises: 075_bank_problem_completed_at
Create Date: 2026-10-22
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "076_mock_skill_ratings"
down_revision = "075_bank_problem_completed_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mock_interview_sessions", sa.Column("skill_ratings", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("mock_interview_sessions", "skill_ratings")
