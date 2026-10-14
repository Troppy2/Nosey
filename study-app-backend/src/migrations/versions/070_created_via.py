"""070 created_via on folders, tests and learning_tracks

"mcp" when an AI app created the row through the Nosey MCP connector, NULL
for everything made in Nosey itself. Hidden: for analytics and debugging,
never shown to users (the audience dislikes AI branding). Flashcards already
have a `source` column and use source="mcp" instead.

Revision ID: 070_created_via
Revises: 069_question_answer_input
Create Date: 2026-10-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "070_created_via"
down_revision = "069_question_answer_input"
branch_labels = None
depends_on = None

_TABLES = ("folders", "tests", "learning_tracks")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(table, sa.Column("created_via", sa.String(length=16), nullable=True))


def downgrade() -> None:
    for table in _TABLES:
        op.drop_column(table, "created_via")
