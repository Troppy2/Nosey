"""add is_beta flag to users (admin-granted beta access)

Beta mode was previously a client-side self-serve toggle in Settings. It is now
an admin decision: an admin grants a user beta access, and only then can that
user see beta features. This adds the backing column. Admins are always treated
as beta on the frontend regardless of this flag, so their rows do not need it set.

Revision ID: 031_add_user_is_beta
Revises: 030_fresh_questions_default_off
Create Date: 2026-07-05 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "031_add_user_is_beta"
down_revision = "030_fresh_questions_default_off"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_beta", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "is_beta")
