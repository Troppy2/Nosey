"""add learning_modules.is_archived (soft-archive completed modules)

Users can archive a passed module to tuck it under the track page's
"Archived" section and bring it back later. Server-side flag so archived
state follows the account across devices.

Revision ID: 037_add_module_is_archived
Revises: 036_add_kojo_action_cards
Create Date: 2026-07-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "037_add_module_is_archived"
down_revision = "036_add_kojo_action_cards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "learning_modules",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("learning_modules", "is_archived")
