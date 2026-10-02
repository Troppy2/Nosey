"""059 add tutor state columns to kojo_messages

Kojo tutor guardrails (GH #108). Each assistant turn records what the tutor
ladder gave, so the backend (not the model) decides when an answer unlocks:
- tutor_intent: concept | own_problem | attempt_check | answer_request
- tutor_subtype: math | mcq | frq | writing | code | none
- tutor_step: parallel_given, hint_given, guided, unlocked, attempt_wrong, ...
- tutor_problem: which problem the ladder tracks ("q:<question_id>" in a test,
  "m:<user message id>" for the message that started it in open chat).
All NULL for rows written before this and for non-tutor turns.

Revision ID: 059_kojo_tutor_state
Revises: 058_folder_file_upload_progress
Create Date: 2026-09-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "059_kojo_tutor_state"
down_revision = "058_folder_file_upload_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kojo_messages", sa.Column("tutor_intent", sa.String(20), nullable=True))
    op.add_column("kojo_messages", sa.Column("tutor_subtype", sa.String(10), nullable=True))
    op.add_column("kojo_messages", sa.Column("tutor_step", sa.String(24), nullable=True))
    op.add_column("kojo_messages", sa.Column("tutor_problem", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("kojo_messages", "tutor_problem")
    op.drop_column("kojo_messages", "tutor_step")
    op.drop_column("kojo_messages", "tutor_subtype")
    op.drop_column("kojo_messages", "tutor_intent")
