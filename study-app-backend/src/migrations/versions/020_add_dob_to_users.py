"""add_dob_and_age_to_users

Revision ID: 020_add_dob_to_users
Revises: 019_usage_event_fields
Create Date: 2026-06-08
"""
from alembic import op
import sqlalchemy as sa


revision = '020_add_dob_to_users'
down_revision = '019_usage_event_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('date_of_birth', sa.Date(), nullable=True))
    op.add_column('users', sa.Column('age', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'age')
    op.drop_column('users', 'date_of_birth')
