"""057 add device_id to llm_token_usage and quota_charges

Browser-generated device id (X-Device-Id header, a UUID kept in the client's
localStorage plus a first-party cookie). Stamped on usage rows of usage-limited
users so the rolling-window limits apply per device as well as per account:
several accounts (Google or guest) on one device share one budget. Best-effort
by design: a determined user can clear storage, but it stops casual
multi-account and guest-account farming.

Revision ID: 057_usage_device_id
Revises: 056_llm_usage_and_quota
Create Date: 2026-09-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "057_usage_device_id"
down_revision = "056_llm_usage_and_quota"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("llm_token_usage", sa.Column("device_id", sa.String(36), nullable=True))
    op.create_index(
        "ix_llm_token_usage_device_feature_created",
        "llm_token_usage",
        ["device_id", "feature", "created_at"],
    )
    op.add_column("quota_charges", sa.Column("device_id", sa.String(36), nullable=True))
    op.create_index(
        "ix_quota_charges_device_feature_created",
        "quota_charges",
        ["device_id", "feature", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_quota_charges_device_feature_created", table_name="quota_charges")
    op.drop_column("quota_charges", "device_id")
    op.drop_index("ix_llm_token_usage_device_feature_created", table_name="llm_token_usage")
    op.drop_column("llm_token_usage", "device_id")
