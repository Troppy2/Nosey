"""add_usage_event_provider_fields

Revision ID: 019_add_usage_event_provider_fields
Revises: 018_add_lc_problem_notes
Create Date: 2026-06-03
"""
from alembic import op
import sqlalchemy as sa


revision = '019_usage_event_fields'
down_revision = '018_add_lc_problem_notes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('usage_events', sa.Column('provider', sa.String(length=30), nullable=True))
    op.add_column('usage_events', sa.Column('success', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('usage_events', sa.Column('error_type', sa.String(length=50), nullable=True))
    op.create_index(op.f('ix_usage_events_provider'), 'usage_events', ['provider'], unique=False)
    op.create_index(op.f('ix_usage_events_success'), 'usage_events', ['success'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_usage_events_success'), table_name='usage_events')
    op.drop_index(op.f('ix_usage_events_provider'), table_name='usage_events')
    op.drop_column('usage_events', 'error_type')
    op.drop_column('usage_events', 'success')
    op.drop_column('usage_events', 'provider')
