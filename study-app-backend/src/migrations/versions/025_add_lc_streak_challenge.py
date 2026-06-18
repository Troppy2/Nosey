"""025 add lc_streak_challenges table for Save My Streak feature

Revision ID: 025_lc_streak_challenge
Revises: 024_lc_custom_archived
Create Date: 2026-06-17
"""
import sqlalchemy as sa
from alembic import op

revision = "025_lc_streak_challenge"
down_revision = "024_lc_custom_archived"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lc_streak_challenges",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lc_streak_challenges_user_id", "lc_streak_challenges", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_lc_streak_challenges_user_id", table_name="lc_streak_challenges")
    op.drop_table("lc_streak_challenges")
