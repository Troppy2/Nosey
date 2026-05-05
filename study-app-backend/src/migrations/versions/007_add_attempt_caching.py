"""Add attempt caching: status and exited_at fields

Revision ID: 007_add_attempt_caching
Revises: 006_add_coding_mode
Create Date: 2026-05-03
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "007_add_attempt_caching"
down_revision = "006_add_coding_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_attempts", sa.Column("status", sa.String(20), nullable=False, server_default="in_progress"))
    op.add_column("user_attempts", sa.Column("exited_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_attempts", "exited_at")
    op.drop_column("user_attempts", "status")
