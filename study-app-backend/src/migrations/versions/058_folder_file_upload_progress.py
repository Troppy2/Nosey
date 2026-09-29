"""058 add upload progress, note, and raw hash to folder_files

Uploads are parsed one page at a time in the background (GH #107):
- pages_done / pages_total drive the "Reading page 42 of 300" row status.
  pages_done stays NULL while the file waits for the parse slot.
- upload_note tells the user when only part of a long PDF was read.
- raw_hash (sha256 of the uploaded bytes) rejects an exact re-upload before it
  spends minutes in the single parse slot. NULL for rows uploaded before this.

Revision ID: 058_folder_file_upload_progress
Revises: 057_usage_device_id
Create Date: 2026-09-29
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "058_folder_file_upload_progress"
down_revision = "057_usage_device_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("folder_files", sa.Column("upload_note", sa.Text(), nullable=True))
    op.add_column("folder_files", sa.Column("pages_done", sa.Integer(), nullable=True))
    op.add_column("folder_files", sa.Column("pages_total", sa.Integer(), nullable=True))
    op.add_column("folder_files", sa.Column("raw_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("folder_files", "raw_hash")
    op.drop_column("folder_files", "pages_total")
    op.drop_column("folder_files", "pages_done")
    op.drop_column("folder_files", "upload_note")
