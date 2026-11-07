"""083 lectures

Kojo pattern lectures (shared, written by an admin's MCP connector), user requests
for new topics, and their shared recorded narration.

Revision ID: 083_lectures
Revises: 082_walkthrough_audio
Create Date: 2026-11-07
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "083_lectures"
down_revision = "082_walkthrough_audio"
branch_labels = None
depends_on = None

ID = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "lc_lectures",
        sa.Column("id", ID, primary_key=True, autoincrement=True),
        sa.Column("slug", sa.String(120), nullable=False, unique=True),
        sa.Column("category", sa.String(60), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("summary", sa.String(400), nullable=False, server_default=""),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="curated"),
        sa.Column("lecture_json", sa.Text(), nullable=False),
        sa.Column("author_id", ID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        *_stamps(),
    )
    op.create_index("ix_lc_lectures_category", "lc_lectures", ["category"])
    op.create_table(
        "lc_lecture_requests",
        sa.Column("id", ID, primary_key=True, autoincrement=True),
        sa.Column("user_id", ID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("topic", sa.String(120), nullable=False),
        sa.Column("normalized", sa.String(120), nullable=False),
        sa.Column("category", sa.String(60), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("lecture_slug", sa.String(120), nullable=True),
        *_stamps(),
    )
    op.create_index("ix_lc_lecture_requests_user_id", "lc_lecture_requests", ["user_id"])
    op.create_index("ix_lc_lecture_requests_normalized", "lc_lecture_requests", ["normalized"])
    op.create_table(
        "lc_lecture_audio",
        sa.Column("id", ID, primary_key=True, autoincrement=True),
        sa.Column("lecture_slug", sa.String(120), nullable=False),
        sa.Column("voice", sa.String(40), nullable=False),
        sa.Column("lines_hash", sa.String(64), nullable=False),
        sa.Column("clips_json", sa.Text(), nullable=False),
        *_stamps(),
        sa.UniqueConstraint("lecture_slug", "voice", "lines_hash", name="uq_lc_lecture_audio"),
    )
    op.create_index("ix_lc_lecture_audio_lecture_slug", "lc_lecture_audio", ["lecture_slug"])


def downgrade() -> None:
    op.drop_index("ix_lc_lecture_audio_lecture_slug", table_name="lc_lecture_audio")
    op.drop_table("lc_lecture_audio")
    op.drop_index("ix_lc_lecture_requests_normalized", table_name="lc_lecture_requests")
    op.drop_index("ix_lc_lecture_requests_user_id", table_name="lc_lecture_requests")
    op.drop_table("lc_lecture_requests")
    op.drop_index("ix_lc_lectures_category", table_name="lc_lectures")
    op.drop_table("lc_lectures")
