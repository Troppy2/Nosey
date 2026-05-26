"""add conversation files

Revision ID: 012_conversation_files
Revises: 011_folder_kojo_settings
Create Date: 2026-05-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "012_conversation_files"
down_revision = "011_folder_kojo_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversation_files",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.BigInteger(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_type", sa.String(length=50), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("uploaded_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["conversation_id"], ["kojo_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_conversation_files_conversation_id", "conversation_files", ["conversation_id"])


def downgrade() -> None:
    op.drop_index("ix_conversation_files_conversation_id", table_name="conversation_files")
    op.drop_table("conversation_files")
