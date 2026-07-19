"""add KojoCode phase 2 tables (daily kojo, struggle events, prep banks, drills)

Extends lc_custom_problems with a source/daily_date pair (so a generated Daily
KojoCode problem reuses the custom-problem plumbing but is one-per-calendar-day),
and adds the struggle-event log, prep banks, bank problems, and drill schedule
tables that the rest of the KojoCode phase 2 build sits on. Slug-keyed throughout:
the backend has no problem catalog, every problem reference is a plain string slug.

Revision ID: 040_add_kojocode_phase2
Revises: 039_add_user_memories
Create Date: 2026-07-17 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "040_add_kojocode_phase2"
down_revision = "039_add_user_memories"
branch_labels = None
depends_on = None

BIGINT_ID = sa.BigInteger().with_variant(sa.Integer, "sqlite")

_DAILY_KOJO_WHERE = sa.text("source = 'daily_kojo'")


def upgrade() -> None:
    # ── lc_custom_problems: Daily KojoCode source + one-per-day lock ──────────
    op.add_column(
        "lc_custom_problems",
        sa.Column("source", sa.String(length=20), nullable=False, server_default="user"),
    )
    # YYYY-MM-DD string, matching the existing lc_activity_dates.activity_date
    # convention (not a Date type). Null for ordinary user-authored problems.
    op.add_column(
        "lc_custom_problems",
        sa.Column("daily_date", sa.String(length=10), nullable=True),
    )
    # Partial unique index: at most one daily_kojo problem per user per calendar
    # day. WHERE clause is applied on Postgres (postgresql_where) and SQLite
    # (sqlite_where) so local-dev parity holds; both dialects honor partial indexes.
    op.create_index(
        "uq_lc_custom_daily_per_user",
        "lc_custom_problems",
        ["user_id", "daily_date"],
        unique=True,
        postgresql_where=_DAILY_KOJO_WHERE,
        sqlite_where=_DAILY_KOJO_WHERE,
    )

    # ── lc_struggle_events: raw signal log (no rollup table) ──────────────────
    op.create_table(
        "lc_struggle_events",
        sa.Column("id", BIGINT_ID, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            BIGINT_ID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("topic", sa.String(length=120), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_lc_struggle_events_user_id", "lc_struggle_events", ["user_id"])

    # ── lc_prep_banks: one active bank per user (enforced in service layer) ────
    op.create_table(
        "lc_prep_banks",
        sa.Column("id", BIGINT_ID, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            BIGINT_ID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("target", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_lc_prep_banks_user_id", "lc_prep_banks", ["user_id"])

    # ── lc_bank_problems: slugs held in a bank (catalog or custom-*) ───────────
    op.create_table(
        "lc_bank_problems",
        sa.Column("id", BIGINT_ID, primary_key=True, autoincrement=True),
        sa.Column(
            "bank_id",
            BIGINT_ID,
            sa.ForeignKey("lc_prep_banks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("problem_slug", sa.String(length=200), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("bank_id", "problem_slug", name="uq_lc_bank_problem"),
    )
    op.create_index("ix_lc_bank_problems_bank_id", "lc_bank_problems", ["bank_id"])

    # ── lc_drill_schedule: 3-pass spaced repetition, one row per problem ───────
    op.create_table(
        "lc_drill_schedule",
        sa.Column("id", BIGINT_ID, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            BIGINT_ID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("problem_slug", sa.String(length=200), nullable=False),
        sa.Column("current_pass", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("next_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("added_from", sa.String(length=10), nullable=False, server_default="auto"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "problem_slug", name="uq_lc_drill_user_problem"),
    )
    op.create_index("ix_lc_drill_schedule_user_id", "lc_drill_schedule", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_lc_drill_schedule_user_id", table_name="lc_drill_schedule")
    op.drop_table("lc_drill_schedule")

    op.drop_index("ix_lc_bank_problems_bank_id", table_name="lc_bank_problems")
    op.drop_table("lc_bank_problems")

    op.drop_index("ix_lc_prep_banks_user_id", table_name="lc_prep_banks")
    op.drop_table("lc_prep_banks")

    op.drop_index("ix_lc_struggle_events_user_id", table_name="lc_struggle_events")
    op.drop_table("lc_struggle_events")

    op.drop_index("uq_lc_custom_daily_per_user", table_name="lc_custom_problems")
    op.drop_column("lc_custom_problems", "daily_date")
    op.drop_column("lc_custom_problems", "source")
