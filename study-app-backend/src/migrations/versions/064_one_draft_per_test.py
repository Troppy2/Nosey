"""064 at most one in_progress draft per user per test

Two overlapping first autosaves both created a draft (GH #137). A partial
unique index makes the second one conflict, and get_or_create_draft then
re-selects the winner's draft instead of failing.

Duplicates already in the table would block the index, so all but the newest
in_progress draft per (user, test) are deleted first. Those extras were ghost
drafts: every read path (get_draft, resume) only ever saw one of them.

Revision ID: 064_one_draft_per_test
Revises: 063_question_groups
Create Date: 2026-10-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "064_one_draft_per_test"
down_revision = "063_question_groups"
branch_labels = None
depends_on = None

_DRAFT_WHERE = sa.text("status = 'in_progress'")


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM user_attempts
        WHERE status = 'in_progress'
          AND id NOT IN (
            SELECT MAX(id) FROM user_attempts
            WHERE status = 'in_progress'
            GROUP BY user_id, test_id
          )
        """
    )
    op.create_index(
        "uq_attempt_one_draft",
        "user_attempts",
        ["user_id", "test_id"],
        unique=True,
        postgresql_where=_DRAFT_WHERE,
        sqlite_where=_DRAFT_WHERE,
    )


def downgrade() -> None:
    op.drop_index("uq_attempt_one_draft", table_name="user_attempts")
