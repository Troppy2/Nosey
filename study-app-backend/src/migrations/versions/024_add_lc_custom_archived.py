"""024 add is_archived to lc_custom_problems: soft-archive custom questions

Revision ID: 024_lc_custom_archived
Revises: 023_lc_custom_problems
Create Date: 2026-06-16
"""
import sqlalchemy as sa
from alembic import op

revision = "024_lc_custom_archived"
down_revision = "023_lc_custom_problems"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lc_custom_problems",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("lc_custom_problems", "is_archived")
