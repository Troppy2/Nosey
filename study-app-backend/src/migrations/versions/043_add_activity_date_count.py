"""add per-day solved count to lc_activity_dates

The activity heatmap and streak logic only needed day-level "active / not active"
signal, so lc_activity_dates stored one row per (user, date) with no tally. The
Practice rhythm stats board now shows "X problems solved today" and the heatmap
surfaces per-day counts, so this adds a count column. Existing rows backfill to 1
(one known solve for any day that already has a row).

Revision ID: 043_add_activity_date_count
Revises: 042_add_test_runs_improvement
Create Date: 2026-07-21 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "043_add_activity_date_count"
down_revision = "042_add_test_runs_improvement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lc_activity_dates",
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("lc_activity_dates", "count")
