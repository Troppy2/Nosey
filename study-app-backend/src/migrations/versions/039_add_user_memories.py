"""add user_memories (weekly per-user study recap)

One row per user holding a short server-generated summary of what the student
has been studying over the past week. Regenerated on demand when stale, shown
in Settings, and injected into Kojo's chat prompt.

Revision ID: 039_add_user_memories
Revises: 038_track_archive
Create Date: 2026-07-17 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "039_add_user_memories"
down_revision = "038_track_archive"
branch_labels = None
depends_on = None

BIGINT_ID = sa.BigInteger().with_variant(sa.Integer, "sqlite")


def upgrade() -> None:
    op.create_table(
        "user_memories",
        sa.Column("id", BIGINT_ID, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            BIGINT_ID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("generated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_user_memories_user_id", "user_memories", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_memories_user_id", table_name="user_memories")
    op.drop_table("user_memories")
