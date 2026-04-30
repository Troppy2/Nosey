"""add math mode to tests

Revision ID: 003_add_math_mode
Revises: 002_add_kojo_tables
Create Date: 2026-04-29
"""
import sqlalchemy as sa
from alembic import op

revision = "003_add_math_mode"
down_revision = "002_add_kojo_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tests",
        sa.Column("is_math_mode", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("tests", "is_math_mode")
