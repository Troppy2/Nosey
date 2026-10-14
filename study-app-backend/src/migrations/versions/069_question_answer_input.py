"""069 questions.answer_input + code_language for Custom mode

A Custom-mode test sets the answer input per question ("choice", "text",
"math", "code") instead of once per test, so one test can mix typed text,
math keyboard and code answers. NULL means "use the test's mode": every
existing question keeps grading exactly as before.

Revision ID: 069_question_answer_input
Revises: 068_mcp_oauth
Create Date: 2026-10-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "069_question_answer_input"
down_revision = "068_mcp_oauth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("answer_input", sa.String(length=8), nullable=True))
    op.add_column("questions", sa.Column("code_language", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("questions", "code_language")
    op.drop_column("questions", "answer_input")
