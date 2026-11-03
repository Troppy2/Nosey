"""079 study_plans

Checklist study plans with auto-completion and custom dashboard widget selection.

Revision ID: 079_study_plans
Revises: 078_flashcards_spaced_repetition
Create Date: 2026-11-02
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "079_study_plans"
down_revision = "078_flashcards_spaced_repetition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "study_plans",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("exam_date", sa.Date(), nullable=True),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_study_plans_user_pinned", "study_plans", ["user_id", "is_pinned"])

    op.create_table(
        "study_plan_items",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column(
            "plan_id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            sa.ForeignKey("study_plans.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("label", sa.String(length=300), nullable=False),
        sa.Column("target_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
        sa.Column("target_count", sa.Integer(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("done_at", sa.DateTime(), nullable=True),
        sa.Column("done_source", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    op.add_column("users", sa.Column("dashboard_widgets", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "dashboard_widgets")
    op.drop_table("study_plan_items")
    op.drop_index("ix_study_plans_user_pinned", table_name="study_plans")
    op.drop_table("study_plans")
