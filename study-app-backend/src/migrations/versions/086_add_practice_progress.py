"""add practice_progress to learning_modules

Article lessons can hold [[scratchpad]] practice problems. Per-problem state
(open / done / gave_up plus the pad's ink) is stored on the module, like
checkpoint_progress, so the quiz gate can be enforced server-side.

Revision ID: 086_add_practice_progress
Revises: 085_folder_search
"""
from alembic import op
import sqlalchemy as sa

revision = "086_add_practice_progress"
down_revision = "085_folder_search"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learning_modules", sa.Column("practice_progress", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("learning_modules", "practice_progress")
