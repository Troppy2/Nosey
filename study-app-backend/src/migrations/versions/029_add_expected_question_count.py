"""029 add expected_question_count column to tests

Stores the number of questions a test is expected to contain once background
generation finishes. The take-test screen reads this to render streaming
progress ("12 of 100 generated so far") while questions are still being written.

Revision ID: 029_expected_question_count
Revises: 028_kojo_load_indexes
Create Date: 2026-06-24
"""
import sqlalchemy as sa
from alembic import op

revision = "029_expected_question_count"
down_revision = "028_kojo_load_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tests", sa.Column("expected_question_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tests", "expected_question_count")
