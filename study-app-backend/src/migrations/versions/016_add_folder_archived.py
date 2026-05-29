"""016 add folder archived — soft-archive folders without deleting them

Revision ID: 016_add_folder_archived
Revises: 015_leetcode_sync_tables
Create Date: 2026-05-28
"""
import sqlalchemy as sa
from alembic import op

revision = "016_add_folder_archived"
down_revision = "015_leetcode_sync_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("folders", "is_archived")
