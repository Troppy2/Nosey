"""082 walkthrough_audio

Recorded narration for a KojoCode walkthrough: every line in one voice, cached so
playback never mixes voices or pays for TTS twice.

Revision ID: 082_walkthrough_audio
Revises: 081_solution_walkthrough
Create Date: 2026-11-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "082_walkthrough_audio"
down_revision = "081_solution_walkthrough"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lc_walkthrough_audio",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("voice", sa.String(40), nullable=False),
        sa.Column("lines_hash", sa.String(64), nullable=False),
        sa.Column("clips_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "problem_slug", "voice", "lines_hash", name="uq_lc_walkthrough_audio"),
    )
    op.create_index("ix_lc_walkthrough_audio_user_id", "lc_walkthrough_audio", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_lc_walkthrough_audio_user_id", table_name="lc_walkthrough_audio")
    op.drop_table("lc_walkthrough_audio")
