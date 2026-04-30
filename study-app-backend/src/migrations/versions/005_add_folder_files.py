"""Add folder_files table for per-folder file management

Revision ID: 005_add_folder_files
Revises: 004_add_kojo_cleared_at
Create Date: 2026-04-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "005_add_folder_files"
down_revision = "004_add_kojo_cleared_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "folder_files",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("folder_id", sa.BigInteger(), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("file_type", sa.String(10), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["folder_id"], ["folders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_folder_files_folder_id", "folder_files", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_folder_files_folder_id", table_name="folder_files")
    op.drop_table("folder_files")
