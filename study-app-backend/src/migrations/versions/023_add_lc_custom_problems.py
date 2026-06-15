"""023 add lc_custom_problems: user-authored LeetCode-style problems

Revision ID: 023_lc_custom_problems
Revises: 022_fresh_questions
Create Date: 2026-06-14
"""
import sqlalchemy as sa
from alembic import op

revision = "023_lc_custom_problems"
down_revision = "022_fresh_questions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lc_custom_problems",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("topic", sa.String(120), nullable=False, server_default="unknown"),
        sa.Column("difficulty", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("url", sa.Text(), nullable=False, server_default=""),
        sa.Column("starter_code", sa.Text(), nullable=False, server_default=""),
        sa.Column("test_cases_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "slug", name="uq_lc_custom_user_slug"),
    )
    op.create_index("ix_lc_custom_problems_user_id", "lc_custom_problems", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_lc_custom_problems_user_id", table_name="lc_custom_problems")
    op.drop_table("lc_custom_problems")
