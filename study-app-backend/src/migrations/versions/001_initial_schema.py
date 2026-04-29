"""initial schema

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-04-28
"""
from alembic import op
import sqlalchemy as sa

revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("google_id", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255)),
        sa.Column("profile_picture_url", sa.Text()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("google_id"),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_google_id", "users", ["google_id"])

    op.create_table(
        "folders",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("subject", sa.String(255)),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "name", name="uq_folders_user_name"),
    )
    op.create_index("ix_folders_user_id", "folders", ["user_id"])

    op.create_table(
        "tests",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("folder_id", sa.BigInteger(), sa.ForeignKey("folders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("test_type", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tests_folder_id", "tests", ["folder_id"])

    op.create_table(
        "flashcards",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("folder_id", sa.BigInteger(), sa.ForeignKey("folders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("front", sa.Text(), nullable=False),
        sa.Column("back", sa.Text(), nullable=False),
        sa.Column("source", sa.String(50)),
        sa.Column("difficulty", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_flashcards_folder_id", "flashcards", ["folder_id"])

    op.create_table(
        "questions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("test_id", sa.BigInteger(), sa.ForeignKey("tests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_type", sa.String(10), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
    )
    op.create_index("ix_questions_test_id", "questions", ["test_id"])

    op.create_table(
        "notes",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("test_id", sa.BigInteger(), sa.ForeignKey("tests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("file_type", sa.String(10), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_notes_test_id", "notes", ["test_id"])

    op.create_table(
        "user_attempts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("test_id", sa.BigInteger(), sa.ForeignKey("tests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("total_score", sa.Numeric(5, 2)),
        sa.Column("total_questions", sa.Integer()),
        sa.Column("correct_count", sa.Integer()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "test_id", "attempt_number", name="uq_attempt_user_test_number"),
    )
    op.create_index("ix_user_attempts_user_id", "user_attempts", ["user_id"])
    op.create_index("ix_user_attempts_test_id", "user_attempts", ["test_id"])

    op.create_table(
        "mcq_options",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("question_id", sa.BigInteger(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("option_text", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("display_order", sa.Integer(), nullable=False),
    )
    op.create_index("ix_mcq_options_question_id", "mcq_options", ["question_id"])

    op.create_table(
        "frq_answers",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("question_id", sa.BigInteger(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expected_answer", sa.Text(), nullable=False),
        sa.UniqueConstraint("question_id"),
    )
    op.create_index("ix_frq_answers_question_id", "frq_answers", ["question_id"])

    op.create_table(
        "user_answers",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("attempt_id", sa.BigInteger(), sa.ForeignKey("user_attempts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.BigInteger(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_answer", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean()),
        sa.Column("ai_feedback", sa.Text()),
        sa.Column("confidence_score", sa.Numeric(3, 2)),
        sa.Column("flagged_uncertain", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("attempt_id", "question_id", name="uq_answer_attempt_question"),
    )
    op.create_index("ix_user_answers_attempt_id", "user_answers", ["attempt_id"])
    op.create_index("ix_user_answers_question_id", "user_answers", ["question_id"])

    op.create_table(
        "flashcard_attempts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("flashcard_id", sa.BigInteger(), sa.ForeignKey("flashcards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("time_ms", sa.Integer()),
        sa.Column("attempt_number", sa.Integer()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_flashcard_attempts_user_id", "flashcard_attempts", ["user_id"])
    op.create_index("ix_flashcard_attempts_flashcard_id", "flashcard_attempts", ["flashcard_id"])


def downgrade() -> None:
    op.drop_table("flashcard_attempts")
    op.drop_table("user_answers")
    op.drop_table("frq_answers")
    op.drop_table("mcq_options")
    op.drop_table("user_attempts")
    op.drop_table("notes")
    op.drop_table("questions")
    op.drop_table("flashcards")
    op.drop_table("tests")
    op.drop_table("folders")
    op.drop_table("users")
