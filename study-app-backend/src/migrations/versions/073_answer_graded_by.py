"""073 user_answers.graded_by

Who last graded the answer: NULL for Nosey's own grader, "agent" when a
connected MCP agent regraded it with regrade_attempt. Results shows a
"Regraded" pill for agent grades.

Revision ID: 073_answer_graded_by
Revises: 072_folder_view_and_instructions
Create Date: 2026-10-18
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "073_answer_graded_by"
down_revision = "072_folder_view_and_instructions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_answers", sa.Column("graded_by", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("user_answers", "graded_by")
