"""047 add custom-company fields to mock_interview_sessions

Adds support for building a mock interview from a pasted job description instead
of a hardcoded FAANG profile. custom_company is the display name, jd_text the raw
job description, and custom_config a JSON blob of the chosen topics, difficulties,
specific problems, and JD-derived role focus / culture. All null for built-in
companies.

Revision ID: 047_custom_company
Revises: 046_add_mock_interview_level
Create Date: 2026-07-27
"""
import sqlalchemy as sa
from alembic import op

revision = "047_custom_company"
down_revision = "046_add_mock_interview_level"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mock_interview_sessions", sa.Column("custom_company", sa.String(length=120), nullable=True))
    op.add_column("mock_interview_sessions", sa.Column("jd_text", sa.Text(), nullable=True))
    op.add_column("mock_interview_sessions", sa.Column("custom_config", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("mock_interview_sessions", "custom_config")
    op.drop_column("mock_interview_sessions", "jd_text")
    op.drop_column("mock_interview_sessions", "custom_company")
