"""077 narration_clips

Pre-generated, low-bitrate narration audio for lessons, notes and episodes, keyed by
(voice, hash of the spoken text) so playback is a database read instead of a model call.

Revision ID: 077_narration_clips
Revises: 076_mock_skill_ratings
Create Date: 2026-10-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "077_narration_clips"
down_revision = "076_mock_skill_ratings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "narration_clips",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("voice", sa.String(length=32), nullable=False),
        sa.Column("text_hash", sa.String(length=64), nullable=False),
        sa.Column("audio", sa.LargeBinary(), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False, server_default="audio/mpeg"),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("voice", "text_hash", name="uq_narration_clip_voice_hash"),
    )


def downgrade() -> None:
    op.drop_table("narration_clips")
