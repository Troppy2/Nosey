"""056 add llm_token_usage and quota_charges

- llm_token_usage: one row per LLM provider HTTP call with the real input and
  output token counts the provider reported (estimated=true when it reported
  none, e.g. a stream closed early). Attributed to user + feature through
  utils.usage_context. Source of truth for token analytics and the Kojo cap.
- quota_charges: count-based charges (tests, flashcards) inside the rolling
  usage window. Refundable when generation fails.

Neither table has a FK to users, same as usage_events: usage history should
survive account cleanup for analytics.

Revision ID: 056_llm_usage_and_quota
Revises: 055_add_system_design_mode
Create Date: 2026-09-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "056_llm_usage_and_quota"
down_revision = "055_add_system_design_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_token_usage",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("feature", sa.String(50), nullable=True),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(now() at time zone 'utc')")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_llm_token_usage_user_feature_created",
        "llm_token_usage",
        ["user_id", "feature", "created_at"],
    )

    op.create_table(
        "quota_charges",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("feature", sa.String(30), nullable=False),
        sa.Column("units", sa.Integer(), nullable=False),
        sa.Column("ref_id", sa.BigInteger(), nullable=True),
        sa.Column("refunded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(now() at time zone 'utc')")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_quota_charges_user_feature_created",
        "quota_charges",
        ["user_id", "feature", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_quota_charges_user_feature_created", table_name="quota_charges")
    op.drop_table("quota_charges")
    op.drop_index("ix_llm_token_usage_user_feature_created", table_name="llm_token_usage")
    op.drop_table("llm_token_usage")
