"""add lc_test_runs and struggle-event lookup index for the refined scorers

The refined weakness scorer needs per-problem run counts (grace period) and passed
runs (success reduction, improvement pass-rate trend), so this adds lc_test_runs.
topic + difficulty are stored on the row because the backend owns no problem catalog
to derive them from; the client sends them. Also adds a (user_id, occurred_at) index
to lc_struggle_events, which both scorers filter their time window on and which had
no supporting index.

Revision ID: 042_add_test_runs_improvement
Revises: 041_add_struggle_event_slug
Create Date: 2026-07-19 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "042_add_test_runs_improvement"
down_revision = "041_add_struggle_event_slug"
branch_labels = None
depends_on = None

BIGINT_ID = sa.BigInteger().with_variant(sa.Integer, "sqlite")


def upgrade() -> None:
    op.create_table(
        "lc_test_runs",
        sa.Column("id", BIGINT_ID, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            BIGINT_ID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("problem_slug", sa.String(length=200), nullable=False),
        sa.Column("topic", sa.String(length=120), nullable=False),
        sa.Column("difficulty", sa.String(length=20), nullable=False, server_default="unknown"),
        sa.Column("passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_lc_test_runs_user_id", "lc_test_runs", ["user_id"])
    op.create_index("ix_lc_test_runs_user_run_at", "lc_test_runs", ["user_id", "run_at"])

    op.create_index(
        "ix_lc_struggle_events_user_occurred",
        "lc_struggle_events",
        ["user_id", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_lc_struggle_events_user_occurred", table_name="lc_struggle_events")

    op.drop_index("ix_lc_test_runs_user_run_at", table_name="lc_test_runs")
    op.drop_index("ix_lc_test_runs_user_id", table_name="lc_test_runs")
    op.drop_table("lc_test_runs")
