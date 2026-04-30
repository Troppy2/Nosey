"""add cleared_at to kojo_conversations

Revision ID: 004_add_kojo_cleared_at
Revises: 003_add_math_mode
Create Date: 2026-04-29
"""

import sqlalchemy as sa
from alembic import op

revision = "004_add_kojo_cleared_at"
down_revision = "003_add_math_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kojo_conversations",
        sa.Column("cleared_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("kojo_conversations", "cleared_at")
