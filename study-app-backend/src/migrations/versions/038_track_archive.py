"""move archiving from module level to track level

Replaces the per-module is_archived flag (037) with a per-TRACK is_archived
flag. A folder may now hold ONE active track plus any number of archived
tracks, so the old one-track-per-folder unique constraint is swapped for a
partial unique index that only applies to non-archived tracks. This lets a
user archive a finished track, build a fresh one, and still revisit old
tracks later.

Revision ID: 038_track_archive
Revises: 037_add_module_is_archived
Create Date: 2026-07-15 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "038_track_archive"
down_revision = "037_add_module_is_archived"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the short-lived per-module flag (037); archiving is track-level now.
    op.drop_column("learning_modules", "is_archived")

    op.add_column(
        "learning_tracks",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # One ACTIVE track per folder; archived tracks are exempt so they can pile up.
    op.drop_constraint("uq_learning_tracks_folder_id", "learning_tracks", type_="unique")
    op.create_index(
        "uq_learning_tracks_active_folder",
        "learning_tracks",
        ["folder_id"],
        unique=True,
        postgresql_where=sa.text("is_archived = false"),
        sqlite_where=sa.text("is_archived = 0"),
    )


def downgrade() -> None:
    op.drop_index("uq_learning_tracks_active_folder", table_name="learning_tracks")
    op.create_unique_constraint("uq_learning_tracks_folder_id", "learning_tracks", ["folder_id"])
    op.drop_column("learning_tracks", "is_archived")

    op.add_column(
        "learning_modules",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
