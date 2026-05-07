"""add_folder_file_content_hash

Revision ID: 009_content_hash
Revises: 008_drop_beta_tables
Create Date: 2026-05-06

"""
import sqlalchemy as sa
from alembic import op

revision = '009_content_hash'
down_revision = '008_drop_beta_tables'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'folder_files',
        sa.Column('content_hash', sa.String(64), nullable=False, server_default=''),
    )
    op.create_index(
        'ix_folder_files_folder_id_content_hash',
        'folder_files',
        ['folder_id', 'content_hash'],
    )


def downgrade() -> None:
    op.drop_index('ix_folder_files_folder_id_content_hash', table_name='folder_files')
    op.drop_column('folder_files', 'content_hash')
