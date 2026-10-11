"""065 add answer_from_sheet and reference_solution to questions

A recreated practice test can come with the student's own answer sheet. Each
question it answers is marked answer_from_sheet (the key is official, never
second-guessed by grading) and keeps the sheet's worked solution and marking
points in reference_solution. Every existing row is false / NULL.

Revision ID: 065_question_answer_sheet
Revises: 064_one_draft_per_test
Create Date: 2026-10-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "065_question_answer_sheet"
down_revision = "064_one_draft_per_test"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column("answer_from_sheet", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("questions", sa.Column("reference_solution", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("questions", "reference_solution")
    op.drop_column("questions", "answer_from_sheet")
