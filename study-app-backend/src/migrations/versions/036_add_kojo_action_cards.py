"""add kojo_action_cards (persisted chat action proposals)

Cards proposed by Kojo in chat (create folder/flashcards/module, start
matching) are persisted so they survive a reload and, once confirmed, feed
the chat's documents panel as created artifacts.

Revision ID: 036_add_kojo_action_cards
Revises: 035_add_module_video_url
Create Date: 2026-07-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "036_add_kojo_action_cards"
down_revision = "035_add_module_video_url"
branch_labels = None
depends_on = None

BIGINT_ID = sa.BigInteger().with_variant(sa.Integer, "sqlite")


def upgrade() -> None:
    op.create_table(
        "kojo_action_cards",
        sa.Column("id", BIGINT_ID, primary_key=True, autoincrement=True),
        sa.Column(
            "conversation_id",
            BIGINT_ID,
            sa.ForeignKey("kojo_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            BIGINT_ID,
            sa.ForeignKey("kojo_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action_type", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="proposed"),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("entity_type", sa.String(length=40), nullable=True),
        sa.Column("entity_id", BIGINT_ID, nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_kojo_action_cards_conversation_id", "kojo_action_cards", ["conversation_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_kojo_action_cards_conversation_id", table_name="kojo_action_cards")
    op.drop_table("kojo_action_cards")
