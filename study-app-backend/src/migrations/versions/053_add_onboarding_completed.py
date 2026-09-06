"""053 add onboarding_completed_at to users (interactive walkthrough)

The first-run walkthrough used to record completion only in localStorage,
which is per-browser. Clearing site data, signing in on a second device, or a
guest account being promoted all reset that flag and re-triggered the
walkthrough for someone who had already finished it. Storing the timestamp on
the user makes completion a property of the account instead of the browser.

Nullable: NULL means "has not finished the walkthrough yet". Existing users
are backfilled to now() in this migration so nobody who has already used the
app is handed a walkthrough on their next visit.

Revision ID: 053_add_onboarding_completed
Revises: 052_add_scratch_pad_strokes
Create Date: 2026-09-06
"""
import sqlalchemy as sa
from alembic import op

revision = "053_add_onboarding_completed"
down_revision = "052_add_scratch_pad_strokes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("onboarding_completed_at", sa.DateTime(), nullable=True))
    # Treat every account that already exists as onboarded. Without this the
    # column ships as NULL for the whole user base and the new walkthrough
    # would fire once for every existing user.
    op.execute("UPDATE users SET onboarding_completed_at = CURRENT_TIMESTAMP")


def downgrade() -> None:
    op.drop_column("users", "onboarding_completed_at")
