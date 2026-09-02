"""051 add track formats (podcast and video-lecture) plus episode artifacts

A learning track now has a format chosen at creation: the existing multi-module
article track, a two-voice podcast episode, or a single-voice video lecture over
a slide deck. Episode formats are exactly one module built in ONE LLM call
straight from the folder's notes, which is what keeps them cheap enough to be
worth offering.

The folder's active-track unique index widens from (folder_id) to
(folder_id, format) so a folder can hold an active article track and an active
podcast track side by side without either evicting the other.

Revision ID: 051_add_track_formats
Revises: 050_add_user_job_descriptions
Create Date: 2026-09-01
"""
import sqlalchemy as sa
from alembic import op

revision = "051_add_track_formats"
down_revision = "050_add_user_job_descriptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "learning_tracks",
        sa.Column("format", sa.String(length=20), nullable=False, server_default="article"),
    )
    # Widen "one active track per folder" to "one active track per folder PER
    # FORMAT". Dropped and recreated rather than altered: it is a partial index
    # and the predicate differs per dialect.
    op.drop_index("uq_learning_tracks_active_folder", table_name="learning_tracks")
    op.create_index(
        "uq_learning_tracks_active_folder",
        "learning_tracks",
        ["folder_id", "format"],
        unique=True,
        postgresql_where=sa.text("is_archived = false"),
        sqlite_where=sa.text("is_archived = 0"),
    )

    # Episode artifacts. Null on article modules, which never have them.
    op.add_column("learning_modules", sa.Column("episode_script", sa.Text(), nullable=True))
    op.add_column("learning_modules", sa.Column("slides", sa.Text(), nullable=True))
    op.add_column("learning_modules", sa.Column("checkpoints", sa.Text(), nullable=True))
    op.add_column("learning_modules", sa.Column("checkpoint_progress", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("learning_modules", "checkpoint_progress")
    op.drop_column("learning_modules", "checkpoints")
    op.drop_column("learning_modules", "slides")
    op.drop_column("learning_modules", "episode_script")
    op.drop_index("uq_learning_tracks_active_folder", table_name="learning_tracks")
    op.create_index(
        "uq_learning_tracks_active_folder",
        "learning_tracks",
        ["folder_id"],
        unique=True,
        postgresql_where=sa.text("is_archived = false"),
        sqlite_where=sa.text("is_archived = 0"),
    )
    op.drop_column("learning_tracks", "format")