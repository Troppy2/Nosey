"""060 add tours_seen to users (first-visit page tours)

Each core page (Folders, Create Test, flashcard modes, Kojo, ...) runs a short
tour the first time a user lands on it. tours_seen records which ones the
account has already been shown, as a JSON array of tour ids in Text, so a tour
never replays on a second device or after a cleared cache.

NULL means "no tours seen". Existing users are backfilled with every tour id
that ships in this release: the tours are for new accounts, and an existing
user should not be ambushed on every page they open after this deploys. A tour
added later is deliberately NOT in this list, so it reaches everyone once.

Revision ID: 060_add_tours_seen
Revises: 059_kojo_tutor_state
Create Date: 2026-09-30
"""
from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "060_add_tours_seen"
down_revision = "059_kojo_tutor_state"
branch_labels = None
depends_on = None

# Must match TourId in study-app-frontend/src/lib/api.ts as of this release.
_LAUNCH_TOURS = [
    "folders",
    "folder-detail",
    "create-test",
    "learning-modes",
    "flashcard-review",
    "matching",
    "manage-flashcards",
    "kojo",
]


def upgrade() -> None:
    op.add_column("users", sa.Column("tours_seen", sa.Text(), nullable=True))
    op.get_bind().execute(
        sa.text("UPDATE users SET tours_seen = :seen"),
        {"seen": json.dumps(_LAUNCH_TOURS)},
    )


def downgrade() -> None:
    op.drop_column("users", "tours_seen")
