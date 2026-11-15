"""090 answer_feedback_sections

Graded feedback as separate sections (note, what to fix, key steps, full
solution, final answer) so Results can lay them out instead of rendering one
Markdown blob. JSON stored as text, like the other JSON columns here. Nullable:
older answers keep only ai_feedback and render the old way.

Revision ID: 090_answer_feedback_sections
Revises: 089_user_saved_resume
Create Date: 2026-11-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "090_answer_feedback_sections"
down_revision = "089_user_saved_resume"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_answers", sa.Column("feedback_sections", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_answers", "feedback_sections")
