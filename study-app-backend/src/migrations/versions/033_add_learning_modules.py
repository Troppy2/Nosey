"""add learning_tracks and learning_modules tables (Learning Modules feature)

A LearningTrack is an AI-authored lesson track built from a folder's saved
notes (one track per folder, regenerating replaces it). Each LearningModule is
one ordered lesson + 5-question MCQ quiz; lesson_content and quiz_json are
nullable because the background generator creates module shells from the
outline first and fills them in one by one.

Revision ID: 033_add_learning_modules
Revises: 032_add_survey_responses
Create Date: 2026-07-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "033_add_learning_modules"
down_revision = "032_add_survey_responses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_tracks",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("folder_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="generating", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("module_count", sa.Integer(), nullable=False),
        sa.Column("notes_hash", sa.String(length=64), nullable=True),
        sa.Column("provider", sa.String(length=20), nullable=True),
        sa.Column("custom_instructions", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["folder_id"], ["folders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("folder_id", name="uq_learning_tracks_folder_id"),
    )
    op.create_index("ix_learning_tracks_folder_id", "learning_tracks", ["folder_id"])

    op.create_table(
        "learning_modules",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("track_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("lesson_content", sa.Text(), nullable=True),
        sa.Column("quiz_json", sa.Text(), nullable=True),
        sa.Column("best_score", sa.Integer(), nullable=True),
        sa.Column("passed", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["track_id"], ["learning_tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_modules_track_id", "learning_modules", ["track_id"])


def downgrade() -> None:
    op.drop_index("ix_learning_modules_track_id", table_name="learning_modules")
    op.drop_table("learning_modules")
    op.drop_index("ix_learning_tracks_folder_id", table_name="learning_tracks")
    op.drop_table("learning_tracks")
