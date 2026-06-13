"""021 add resume_screen to mock_interview_sessions

Stores the ATS resume-screen result JSON for the optional Resume Screen stage.

Revision ID: 021_add_resume_screen
Revises: 020_add_dob_to_users
Create Date: 2026-06-12
"""
import sqlalchemy as sa
from alembic import op

revision = "021_add_resume_screen"
down_revision = "020_add_dob_to_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mock_interview_sessions",
        sa.Column("resume_screen", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("mock_interview_sessions", "resume_screen")
