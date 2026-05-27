"""015 leetcode sync tables — persist progress, activity dates, code workspaces per user

Revision ID: 015_leetcode_sync_tables
Revises: 014_nullable_folder_kojo
Create Date: 2026-05-26
"""
import sqlalchemy as sa
from alembic import op

revision = "015_leetcode_sync_tables"
down_revision = "014_nullable_folder_kojo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lc_progress",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "problem_slug", name="uq_lc_progress_user_problem"),
    )
    op.create_index("ix_lc_progress_user_id", "lc_progress", ["user_id"])

    op.create_table(
        "lc_activity_dates",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("activity_date", sa.String(10), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "activity_date", name="uq_lc_activity_user_date"),
    )
    op.create_index("ix_lc_activity_dates_user_id", "lc_activity_dates", ["user_id"])

    op.create_table(
        "lc_code_workspaces",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("workspace_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "problem_slug", name="uq_lc_workspace_user_problem"),
    )
    op.create_index("ix_lc_code_workspaces_user_id", "lc_code_workspaces", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_lc_code_workspaces_user_id", table_name="lc_code_workspaces")
    op.drop_table("lc_code_workspaces")
    op.drop_index("ix_lc_activity_dates_user_id", table_name="lc_activity_dates")
    op.drop_table("lc_activity_dates")
    op.drop_index("ix_lc_progress_user_id", table_name="lc_progress")
    op.drop_table("lc_progress")
