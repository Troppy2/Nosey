"""071 topic tag on questions and flashcards

A short topic name (2 to 4 words) the LLM writes alongside each generated
question or flashcard. Folder stats group test answers and flashcard
attempts by it to find weak and strong topics. NULL for content made before
this migration, manual content without a topic, and imports.

Revision ID: 071_topic_tags
Revises: 070_created_via
Create Date: 2026-10-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "071_topic_tags"
down_revision = "070_created_via"
branch_labels = None
depends_on = None

_TABLES = ("questions", "flashcards")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(table, sa.Column("topic", sa.String(length=80), nullable=True))
        op.create_index(f"ix_{table}_topic", table, ["topic"])


def downgrade() -> None:
    for table in _TABLES:
        op.drop_index(f"ix_{table}_topic", table_name=table)
        op.drop_column(table, "topic")
