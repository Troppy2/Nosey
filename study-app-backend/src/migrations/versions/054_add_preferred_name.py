"""054 add preferred_name to users

What the user asks to be called, shown in greetings and used by the mock
interviewer. It is a separate column rather than a rewrite of full_name on
purpose: UserRepository.create_or_update() reassigns full_name from the Google
profile on every sign-in, so a preferred name stored there would be silently
reverted the next time the user logged in.

Nullable, with no backfill. NULL means "no preference stated" and display falls
back to full_name, which is exactly the behaviour every existing user has now.

Revision ID: 054_add_preferred_name
Revises: 053_add_onboarding_completed
Create Date: 2026-09-06
"""
import sqlalchemy as sa
from alembic import op

revision = "054_add_preferred_name"
down_revision = "053_add_onboarding_completed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("preferred_name", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "preferred_name")
