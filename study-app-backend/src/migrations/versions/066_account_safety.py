"""066 account safety: bans, re-sign-up tombstones, moderation flags

GH #172 and GH #173.
- users.banned_at / ban_reason / banned_by: a banned account is refused on
  every route. users.last_device_id lets a ban also refuse guest sign-ups
  from the same browser.
- account_tombstones: HMAC of the Google id of a deleted (24h cooldown) or
  banned (no expiry) account, checked before a new account is created.
- content_flags: moderation hits on typed input, for admin review.

Revision ID: 066_account_safety
Revises: 065_question_answer_sheet
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "066_account_safety"
down_revision = "065_question_answer_sheet"
branch_labels = None
depends_on = None

BIGINT = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.add_column("users", sa.Column("banned_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("ban_reason", sa.String(length=500), nullable=True))
    op.add_column("users", sa.Column("banned_by", BIGINT, nullable=True))
    op.add_column("users", sa.Column("last_device_id", sa.String(length=36), nullable=True))
    op.create_index("ix_users_last_device_id", "users", ["last_device_id"])

    op.create_table(
        "account_tombstones",
        sa.Column("id", BIGINT, primary_key=True, autoincrement=True),
        sa.Column("subject_hash", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_account_tombstones_subject_hash", "account_tombstones", ["subject_hash"])

    op.create_table(
        "content_flags",
        sa.Column("id", BIGINT, primary_key=True, autoincrement=True),
        sa.Column("user_id", BIGINT, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature", sa.String(length=40), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("categories", sa.String(length=255), nullable=False),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("excerpt", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("reviewed_by", BIGINT, nullable=True),
        sa.Column("action", sa.String(length=16), nullable=True),
    )
    op.create_index("ix_content_flags_user_created", "content_flags", ["user_id", "created_at"])
    op.create_index("ix_content_flags_unreviewed", "content_flags", ["reviewed_at", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_content_flags_unreviewed", table_name="content_flags")
    op.drop_index("ix_content_flags_user_created", table_name="content_flags")
    op.drop_table("content_flags")
    op.drop_index("ix_account_tombstones_subject_hash", table_name="account_tombstones")
    op.drop_table("account_tombstones")
    op.drop_index("ix_users_last_device_id", table_name="users")
    op.drop_column("users", "last_device_id")
    op.drop_column("users", "banned_by")
    op.drop_column("users", "ban_reason")
    op.drop_column("users", "banned_at")
