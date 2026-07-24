"""add per-problem solved_at timestamp to lc_progress

lc_progress only stored a done boolean, so there was no way to show a history of
when a problem was completed. The KojoCode settings modal now lists previously
completed questions with timestamps, which needs a per-problem solve time. This
adds a nullable solved_at column, set on the done->true transition. No backfill:
problems solved before this migration have no recorded time and render without one.

Revision ID: 044_add_progress_solved_at
Revises: 043_add_activity_date_count
Create Date: 2026-07-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "044_add_progress_solved_at"
down_revision = "043_add_activity_date_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lc_progress",
        sa.Column("solved_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lc_progress", "solved_at")
