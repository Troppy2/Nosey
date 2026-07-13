"""add learning_modules.tts_script (LLM-written spoken lesson script)

The bundled module-generation call now returns a spoken-word script alongside
the lesson markdown, so TTS reads real prose (math and code described in
words) instead of stripped markdown with "see the expression on screen"
placeholders. Nullable: modules generated before this column simply fall back
to the old frontend markdown-stripping path.

Revision ID: 034_add_module_tts_script
Revises: 033_add_learning_modules
Create Date: 2026-07-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "034_add_module_tts_script"
down_revision = "033_add_learning_modules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learning_modules", sa.Column("tts_script", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("learning_modules", "tts_script")
