"""049 mock interview cloud sync: progress snapshot, resume text, resume grill

Mock Interview previously kept every piece of in-flight state in the browser's
localStorage; the server row only held finished artifacts. A refresh on another
device (or after clearing storage) lost the run. These columns make the server
the source of truth:

- progress_json / progress_updated_at: the full client MockProgress snapshot,
  pushed debounced from the client and merged back on mount, mirroring how
  KojoCode syncs code workspaces.
- resume_text / resume_file_name: the extracted resume the ATS screen already
  parsed. Kept so a resumed session still has it, and so the resume grill round
  can quote real bullets.
- resume_grill: JSON feedback from the resume deep-dive round, read by the final
  summary alongside the other stages.

Revision ID: 049_add_mock_interview_cloud_sync
Revises: 048_add_lc_solution_articles
Create Date: 2026-08-04
"""
import sqlalchemy as sa
from alembic import op

revision = "049_add_mock_interview_cloud_sync"
down_revision = "048_add_lc_solution_articles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mock_interview_sessions", sa.Column("progress_json", sa.Text(), nullable=True))
    op.add_column(
        "mock_interview_sessions", sa.Column("progress_updated_at", sa.DateTime(), nullable=True)
    )
    op.add_column("mock_interview_sessions", sa.Column("resume_text", sa.Text(), nullable=True))
    op.add_column(
        "mock_interview_sessions", sa.Column("resume_file_name", sa.String(length=255), nullable=True)
    )
    op.add_column("mock_interview_sessions", sa.Column("resume_grill", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("mock_interview_sessions", "resume_grill")
    op.drop_column("mock_interview_sessions", "resume_file_name")
    op.drop_column("mock_interview_sessions", "resume_text")
    op.drop_column("mock_interview_sessions", "progress_updated_at")
    op.drop_column("mock_interview_sessions", "progress_json")
