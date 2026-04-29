"""add kojo tables

Revision ID: 002_add_kojo_tables
Revises: 001_initial_schema
Create Date: 2026-04-29
"""
import sqlalchemy as sa
from alembic import op

revision = "002_add_kojo_tables"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kojo_conversations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("folder_id", sa.BigInteger(), sa.ForeignKey("folders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "folder_id", name="uq_kojo_user_folder"),
    )
    op.create_index("ix_kojo_conversations_user_id", "kojo_conversations", ["user_id"])
    op.create_index("ix_kojo_conversations_folder_id", "kojo_conversations", ["folder_id"])

    op.create_table(
        "kojo_messages",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "conversation_id",
            sa.BigInteger(),
            sa.ForeignKey("kojo_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_kojo_messages_conversation_id", "kojo_messages", ["conversation_id"])


def downgrade() -> None:
    op.drop_table("kojo_messages")
    op.drop_table("kojo_conversations")
