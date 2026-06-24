"""028 add kojo message + conversation load-path indexes

(conversation_id, created_at) on kojo_messages covers get_history()'s filter
plus ORDER BY created_at DESC plus LIMIT, removing a re-sort on every history
fetch. cleared_at on kojo_conversations covers get_cleared_conversations()'s
filter (small now, grows with chat history).

Revision ID: 028_kojo_load_indexes
Revises: 027_flashcard_attempts_composite_idx
Create Date: 2026-06-24
"""
from alembic import op

revision = "028_kojo_load_indexes"
down_revision = "027_flashcard_attempts_composite_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_kojo_messages_conversation_created",
        "kojo_messages",
        ["conversation_id", "created_at"],
    )
    op.create_index(
        op.f("ix_kojo_conversations_cleared_at"),
        "kojo_conversations",
        ["cleared_at"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_kojo_conversations_cleared_at"),
        table_name="kojo_conversations",
    )
    op.drop_index(
        "ix_kojo_messages_conversation_created",
        table_name="kojo_messages",
    )
