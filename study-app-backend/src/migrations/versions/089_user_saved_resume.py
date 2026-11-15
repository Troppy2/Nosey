"""089 user_saved_resume

One saved resume per user for mock interviews: the extracted text, the original
file name and when it was saved. The ATS screen reuses it instead of asking for
an upload every run.

Revision ID: 089_user_saved_resume
Revises: 088_mock_behavioral_questions
Create Date: 2026-11-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "089_user_saved_resume"
down_revision = "088_mock_behavioral_questions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("saved_resume_text", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("saved_resume_file_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("saved_resume_updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "saved_resume_updated_at")
    op.drop_column("users", "saved_resume_file_name")
    op.drop_column("users", "saved_resume_text")
