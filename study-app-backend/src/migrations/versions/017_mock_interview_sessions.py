"""017 mock_interview_sessions — stores mock interview state per user

Revision ID: 017_mock_interview_sessions
Revises: 016_add_folder_archived
Create Date: 2026-05-30
"""
import sqlalchemy as sa
from alembic import op

revision = "017_mock_interview_sessions"
down_revision = "016_add_folder_archived"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mock_interview_sessions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("company", sa.String(64), nullable=False),
        sa.Column("stages_config", sa.Text(), nullable=False, server_default='["stage1","stage2","stage3"]'),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("stage1_results", sa.Text(), nullable=True),
        sa.Column("stage2_script", sa.Text(), nullable=True),
        sa.Column("stage2_submission", sa.Text(), nullable=True),
        sa.Column("stage3_script", sa.Text(), nullable=True),
        sa.Column("stage3_answers", sa.Text(), nullable=True),
        sa.Column("overall_feedback", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mock_interview_sessions_user_id", "mock_interview_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_mock_interview_sessions_user_id", table_name="mock_interview_sessions")
    op.drop_table("mock_interview_sessions")
