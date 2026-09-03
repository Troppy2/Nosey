"""052 add scratch pad strokes to user_answers (STEM Scratch Pad feature)

Handwritten scratch-work strokes captured while a math attempt is in progress
join the existing draft-attempt round trip, so a drawing resumes across
devices the same way a typed answer already does. Nullable, and only ever
populated on an in_progress (draft) attempt: the draft is deleted at submit
time, so a graded UserAnswer never carries strokes. The rendered image sent to
OCR for grading is never persisted at all; only these in-progress strokes are.

Revision ID: 052_add_scratch_pad_strokes
Revises: 051_add_track_formats
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op

revision = "052_add_scratch_pad_strokes"
down_revision = "051_add_track_formats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_answers", sa.Column("work_strokes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_answers", "work_strokes")
