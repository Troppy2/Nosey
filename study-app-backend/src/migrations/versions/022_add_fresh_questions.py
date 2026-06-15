"""add fresh-questions support: folder toggle and test notes hash

Revision ID: 022_fresh_questions
Revises: 021_add_resume_screen
Create Date: 2026-06-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "022_fresh_questions"
down_revision = "021_add_resume_screen"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("avoid_repeat_questions", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column("tests", sa.Column("notes_hash", sa.String(length=64), nullable=True))
    op.create_index("ix_tests_notes_hash", "tests", ["notes_hash"])


def downgrade() -> None:
    op.drop_index("ix_tests_notes_hash", table_name="tests")
    op.drop_column("tests", "notes_hash")
    op.drop_column("folders", "avoid_repeat_questions")
