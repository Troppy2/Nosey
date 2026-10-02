"""061 add answer_inferred to questions

A question recreated from an uploaded practice test whose document had no
answer for it gets its answer worked out by the model (GH #133). The flag lets
Results say so, and lets written grading treat that reference answer as a
guide rather than the truth. Every existing row is false.

Revision ID: 061_question_answer_inferred
Revises: 060_add_tours_seen
Create Date: 2026-10-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "061_question_answer_inferred"
down_revision = "060_add_tours_seen"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column("answer_inferred", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("questions", "answer_inferred")
