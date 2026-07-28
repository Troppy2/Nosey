"""add lc_solution_articles (cached KojoCode solution write-ups)

Custom (user-authored and Daily KojoCode) problems previously had no solution
reveal at all; the NeetCode iframe only works for official catalog slugs. This
adds a table that caches an LLM-authored "KojoCode solution" per custom problem,
built lazily the first time the user opens the reveal and then kept forever so it
is never regenerated (saving tokens). approach_rank 1 is the optimal approach
(the only one prebuilt); ranks 2/3 are reserved for alternate approaches the user
can request later. Keyed per user because custom-* slugs are per user.

Revision ID: 048_add_lc_solution_articles
Revises: 047_custom_company
Create Date: 2026-07-28 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "048_add_lc_solution_articles"
down_revision = "047_custom_company"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lc_solution_articles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("problem_slug", sa.String(length=200), nullable=False),
        sa.Column("approach_rank", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("title", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("approach_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("solution_code", sa.Text(), nullable=False, server_default=""),
        sa.Column("code_comments_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("time_complexity", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("space_complexity", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("complexity_explanation", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "problem_slug", "approach_rank", name="uq_lc_solution_user_problem_rank"
        ),
    )
    op.create_index(
        "ix_lc_solution_articles_user_id", "lc_solution_articles", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_lc_solution_articles_user_id", table_name="lc_solution_articles")
    op.drop_table("lc_solution_articles")
