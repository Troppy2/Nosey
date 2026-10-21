"""074 sd_custom_topics

System Design topics written by an AI app through the MCP connector: a title
plus content_json in the frontend Concept shape (notes, video, visualizer,
project, quiz). The built-in curriculum stays static frontend content;
progress and submissions reuse the existing tables under "custom-<id>".

Revision ID: 074_sd_custom_topics
Revises: 073_answer_graded_by
Create Date: 2026-10-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "074_sd_custom_topics"
down_revision = "073_answer_graded_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sd_custom_topics",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_via", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_sd_custom_topics_user_id", "sd_custom_topics", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_sd_custom_topics_user_id", table_name="sd_custom_topics")
    op.drop_table("sd_custom_topics")
