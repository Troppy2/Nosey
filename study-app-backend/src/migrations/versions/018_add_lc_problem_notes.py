"""add_lc_problem_notes

Revision ID: 018_add_lc_problem_notes
Revises: 30e3a0b7d13b
Create Date: 2026-06-03 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "018_add_lc_problem_notes"
down_revision = "30e3a0b7d13b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lc_problem_notes",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("problem_slug", sa.String(200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "problem_slug", name="uq_lc_note_user_problem"),
    )
    op.create_index("ix_lc_problem_notes_user_id", "lc_problem_notes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_lc_problem_notes_user_id", table_name="lc_problem_notes")
    op.drop_table("lc_problem_notes")
