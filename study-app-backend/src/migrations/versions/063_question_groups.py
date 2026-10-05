"""063 add question_groups for multi-part practice problems

A recreated practice test split every lettered part into its own question,
each repeating the setup, so a 25-problem homework became 100 one-question
screens (GH #151). A group holds the shared setup once; each part stays an
ordinary question (own answer, own grade) pointing at it.

Every existing question gets group_id NULL: nothing changes for old tests.

Revision ID: 063_question_groups
Revises: 062_answer_ocr_redo
Create Date: 2026-10-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "063_question_groups"
down_revision = "062_answer_ocr_redo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "question_groups",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("test_id", sa.BigInteger(), sa.ForeignKey("tests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=50), nullable=False, server_default=""),
        sa.Column("stem", sa.Text(), nullable=False, server_default=""),
        sa.Column("display_order", sa.Integer(), nullable=False),
    )
    op.create_index("ix_question_groups_test_id", "question_groups", ["test_id"])
    op.add_column(
        "questions",
        sa.Column(
            "group_id",
            sa.BigInteger(),
            sa.ForeignKey("question_groups.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("questions", sa.Column("part_label", sa.String(length=8), nullable=True))
    op.create_index("ix_questions_group_id", "questions", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_questions_group_id", table_name="questions")
    op.drop_column("questions", "part_label")
    op.drop_column("questions", "group_id")
    op.drop_index("ix_question_groups_test_id", table_name="question_groups")
    op.drop_table("question_groups")
