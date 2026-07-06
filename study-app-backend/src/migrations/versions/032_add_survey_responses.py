"""add survey_responses table (post-feature satisfaction surveys)

Stores 1-5 ratings plus an optional comment for the Flashcards, Testing, and
Kojo features. Analytics-style table (indexed user_id, no FK cascade) mirroring
usage_events.

Chained after 031 (is_beta) because both ship in the same wave; this migration
must run after the beta migration.

Revision ID: 032_add_survey_responses
Revises: 031_add_user_is_beta
Create Date: 2026-07-06 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "032_add_survey_responses"
down_revision = "031_add_user_is_beta"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "survey_responses",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("feature", sa.String(length=20), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_survey_responses_user_id", "survey_responses", ["user_id"])
    op.create_index("ix_survey_responses_feature", "survey_responses", ["feature"])


def downgrade() -> None:
    op.drop_index("ix_survey_responses_feature", table_name="survey_responses")
    op.drop_index("ix_survey_responses_user_id", table_name="survey_responses")
    op.drop_table("survey_responses")
