"""027 add composite index on flashcard_attempts (flashcard_id, user_id)

list_with_stats() joins flashcards to attempts filtering on both flashcard_id
and user_id. The separate single-column indexes force PostgreSQL to use one and
filter the other in memory. This composite index covers the double-filter
directly, speeding up the flashcard list/stats load.

Revision ID: 027_flashcard_attempt_idx
Revises: 026_answer_ai_reasoning
Create Date: 2026-06-24
"""
from alembic import op

revision = "027_flashcard_attempt_idx"
down_revision = "026_answer_ai_reasoning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_flashcard_attempts_flashcard_user",
        "flashcard_attempts",
        ["flashcard_id", "user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_flashcard_attempts_flashcard_user",
        table_name="flashcard_attempts",
    )
