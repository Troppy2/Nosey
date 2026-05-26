"""014 nullable folder kojo — allow general (no-folder) conversations

Revision ID: 014_nullable_folder_kojo
Revises: 013_multi_chat_kojo
Create Date: 2026-05-25
"""
from alembic import op

revision = "014_nullable_folder_kojo"
down_revision = "013_multi_chat_kojo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("kojo_conversations", "folder_id", nullable=True)


def downgrade() -> None:
    # Cannot safely reverse if NULL rows exist; ensure none before downgrading
    op.alter_column("kojo_conversations", "folder_id", nullable=False)
