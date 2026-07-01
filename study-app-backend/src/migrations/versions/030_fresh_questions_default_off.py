"""flip fresh-questions-on-re-test default to OFF (opt-in)

Fresh questions on re-test is now off by default; a user must turn the
folder toggle ON to avoid repeating questions. This changes the column
server_default from true to false and resets existing rows that still hold
the old auto-default so the new "repeats by default" behavior applies
retroactively. Folders where a user had explicitly opted out (false) are
unaffected either way.

Revision ID: 030_fresh_questions_default_off
Revises: 029_expected_question_count
Create Date: 2026-06-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "030_fresh_questions_default_off"
down_revision = "029_expected_question_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "folders",
        "avoid_repeat_questions",
        existing_type=sa.Boolean(),
        server_default=sa.false(),
        existing_nullable=False,
    )
    # Reset existing rows to the new default. Prior true values came from the
    # old auto-default (fresh was on by default), not an explicit user choice,
    # so resetting them to false realizes "repeats by default" for existing folders.
    op.execute("UPDATE folders SET avoid_repeat_questions = false")


def downgrade() -> None:
    op.alter_column(
        "folders",
        "avoid_repeat_questions",
        existing_type=sa.Boolean(),
        server_default=sa.true(),
        existing_nullable=False,
    )
    # Best-effort restore of the prior default value. Individual pre-migration
    # choices are not recoverable.
    op.execute("UPDATE folders SET avoid_repeat_questions = true")
