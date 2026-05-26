"""add folder kojo settings

Revision ID: 011_folder_kojo_settings
Revises: 010_slash_commands
Create Date: 2026-05-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "011_folder_kojo_settings"
down_revision = "010_slash_commands"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("folders", sa.Column("kojo_sync_default", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("folders", sa.Column("kojo_allow_artifacts", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("folders", sa.Column("kojo_auto_index", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("folders", sa.Column("kojo_persona", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("folders", "kojo_persona")
    op.drop_column("folders", "kojo_auto_index")
    op.drop_column("folders", "kojo_allow_artifacts")
    op.drop_column("folders", "kojo_sync_default")
