"""add last_used_at to the stored TTS audio tables

Narration clips, KojoCode walkthrough audio and lecture audio are caches. Each
row now records when it was last served, and the periodic sweep deletes rows
idle longer than AUDIO_CACHE_TTL_HOURS, so audio nobody plays stops taking
Postgres storage. Existing rows start at now(), so nothing is purged until a
full TTL after this migration.

Revision ID: 087_audio_last_used_at
Revises: 086_add_practice_progress
"""
from alembic import op
import sqlalchemy as sa

revision = "087_audio_last_used_at"
down_revision = "086_add_practice_progress"
branch_labels = None
depends_on = None

_TABLES = ("narration_clips", "lc_walkthrough_audio", "lc_lecture_audio")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("last_used_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )
        op.create_index(f"ix_{table}_last_used_at", table, ["last_used_at"])


def downgrade() -> None:
    for table in _TABLES:
        op.drop_index(f"ix_{table}_last_used_at", table_name=table)
        op.drop_column(table, "last_used_at")
