"""062 add OCR redo columns to user_answers

A scratch-pad drawing that OCR could not read (or read with low legibility)
used to be graded as if no drawing had been sent, so a draw-only answer scored
as blank with no explanation (GH #149). Now such an answer is held as
`needs_input`: Results hides its answer key and lets the student fix the kept
strokes or type the answer once, then regrades it in place.

- work_transcript: what OCR read from the drawing, shown on Results as
  "What I read from your work". The rendered image itself is still never
  persisted.
- ocr_status: NULL (no drawing), ok, needs_input, resolved, skipped.
- work_strokes (existing) is now also kept on a graded row, but only while it
  is needs_input, and cleared once resolved or skipped.

Every existing row gets NULLs, which reads as "no drawing".

Revision ID: 062_answer_ocr_redo
Revises: 061_question_answer_inferred
Create Date: 2026-10-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "062_answer_ocr_redo"
down_revision = "061_question_answer_inferred"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_answers", sa.Column("work_transcript", sa.Text(), nullable=True))
    op.add_column("user_answers", sa.Column("ocr_status", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("user_answers", "ocr_status")
    op.drop_column("user_answers", "work_transcript")
