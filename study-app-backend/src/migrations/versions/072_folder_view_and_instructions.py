"""072 folder default view + test instructions, tests.kind

folders.default_view: which panel the folder page opens on, "stats"
(default) or "flashcards". folders.test_instructions: folder-level "how Kojo
makes tests" text, prefilled into Create Test's custom instructions.
tests.kind: "daily" for the folder's daily weak-spot quiz, NULL otherwise.

Revision ID: 072_folder_view_and_instructions
Revises: 071_topic_tags
Create Date: 2026-10-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "072_folder_view_and_instructions"
down_revision = "071_topic_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("default_view", sa.String(length=16), nullable=False, server_default="stats"),
    )
    op.add_column("folders", sa.Column("test_instructions", sa.Text(), nullable=True))
    op.add_column("tests", sa.Column("kind", sa.String(length=16), nullable=True))
    op.create_index("ix_tests_folder_kind", "tests", ["folder_id", "kind"])


def downgrade() -> None:
    op.drop_index("ix_tests_folder_kind", table_name="tests")
    op.drop_column("tests", "kind")
    op.drop_column("folders", "test_instructions")
    op.drop_column("folders", "default_view")
