"""add problem_slug to lc_struggle_events

The KojoCode phase 2 plan's struggle-event body only carried topic + event_type,
but step 7's auto-add-drill hook ("create a drill row for a problem the user
hasn't already got an open drill row for") needs a problem slug to key on for
timer_expiry events (hint/grade events already have title_slug on their request,
but had nowhere on the event row to persist it). Nullable: only timer_expiry
callers are required to supply it going forward.

Revision ID: 041_add_struggle_event_slug
Revises: 040_add_kojocode_phase2
Create Date: 2026-07-17 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "041_add_struggle_event_slug"
down_revision = "040_add_kojocode_phase2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lc_struggle_events",
        sa.Column("problem_slug", sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lc_struggle_events", "problem_slug")
