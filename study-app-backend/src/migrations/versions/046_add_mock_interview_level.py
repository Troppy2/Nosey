"""046 add level to mock_interview_sessions

Adds the target seniority level (intern | junior | mid | senior) chosen at
session creation. Drives coding difficulty distribution and interviewer rigor.
Existing rows backfill to 'intern' via the server default.

Revision ID: 046_add_mock_interview_level
Revises: 045_add_subtopic
Create Date: 2026-07-27
"""
import sqlalchemy as sa
from alembic import op

revision = "046_add_mock_interview_level"
down_revision = "045_add_subtopic"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mock_interview_sessions",
        sa.Column(
            "level",
            sa.String(length=16),
            nullable=False,
            server_default="intern",
        ),
    )


def downgrade() -> None:
    op.drop_column("mock_interview_sessions", "level")
