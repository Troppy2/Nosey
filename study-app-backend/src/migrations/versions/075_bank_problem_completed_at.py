"""075 completed_at on lc_bank_problems

Prep banks are cold interview practice: a problem counts as done in a bank
only once it is solved after being added there, separate from the global
lc_progress.done flag. Existing rows start NULL (not done), so every bank
the user already has becomes a fresh cold run.

Revision ID: 075_bank_problem_completed_at
Revises: 074_sd_custom_topics
Create Date: 2026-10-22
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "075_bank_problem_completed_at"
down_revision = "074_sd_custom_topics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lc_bank_problems", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("lc_bank_problems", "completed_at")
