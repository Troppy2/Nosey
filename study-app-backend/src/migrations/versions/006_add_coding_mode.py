"""Add coding mode fields to tests

Revision ID: 006_add_coding_mode
Revises: 005_add_folder_files
Create Date: 2026-04-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "006_add_coding_mode"
down_revision = "005_add_folder_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tests", sa.Column("is_coding_mode", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("tests", sa.Column("coding_language", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("tests", "coding_language")
    op.drop_column("tests", "is_coding_mode")
