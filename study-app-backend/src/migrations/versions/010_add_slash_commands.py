"""add slash commands

Revision ID: 010_slash_commands
Revises: d66f3a7e3e9d
Create Date: 2026-05-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "010_slash_commands"
down_revision = "d66f3a7e3e9d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "slash_commands",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("slash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "slash", name="uq_slash_commands_user_slash"),
    )
    op.create_index(op.f("ix_slash_commands_user_id"), "slash_commands", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_slash_commands_user_id"), table_name="slash_commands")
    op.drop_table("slash_commands")
