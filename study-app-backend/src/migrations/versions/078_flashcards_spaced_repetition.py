"""078 flashcards_spaced_repetition

Spaced repetition columns for flashcards and attempt ratings.

Revision ID: 078_flashcards_spaced_repetition
Revises: 077_narration_clips
Create Date: 2026-11-02
"""
from __future__ import annotations

from datetime import datetime
import sqlalchemy as sa
from alembic import op

from src.services.flashcard_scheduler import CardScheduleState, schedule

revision = "078_flashcards_spaced_repetition"
down_revision = "077_narration_clips"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("flashcards", sa.Column("ease", sa.Float(), nullable=False, server_default="2.5"))
    op.add_column("flashcards", sa.Column("interval_days", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("flashcards", sa.Column("reps", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("flashcards", sa.Column("lapses", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("flashcards", sa.Column("due_at", sa.DateTime(), nullable=True))
    op.add_column("flashcards", sa.Column("last_reviewed_at", sa.DateTime(), nullable=True))
    op.create_index("ix_flashcards_folder_id_due_at", "flashcards", ["folder_id", "due_at"])

    op.add_column("flashcard_attempts", sa.Column("rating", sa.String(length=16), nullable=True))

    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE flashcard_attempts "
        "SET rating = CASE WHEN correct THEN 'medium' ELSE 'hard' END "
        "WHERE rating IS NULL"
    ))

    card_id_rows = conn.execute(sa.text(
        "SELECT DISTINCT flashcard_id FROM flashcard_attempts ORDER BY flashcard_id"
    )).fetchall()
    card_ids = [row[0] for row in card_id_rows]

    BATCH_SIZE = 500
    for i in range(0, len(card_ids), BATCH_SIZE):
        batch_ids = card_ids[i:i + BATCH_SIZE]
        attempts_stmt = sa.text(
            "SELECT flashcard_id, correct, rating, created_at "
            "FROM flashcard_attempts "
            "WHERE flashcard_id IN :ids "
            "ORDER BY flashcard_id, created_at ASC, id ASC"
        ).bindparams(sa.bindparam("ids", expanding=True))
        attempt_rows = conn.execute(attempts_stmt, {"ids": batch_ids}).fetchall()

        card_attempts: dict[int, list] = {}
        for row in attempt_rows:
            card_attempts.setdefault(row[0], []).append(row)

        for cid in batch_ids:
            attempts = card_attempts.get(cid, [])
            if not attempts:
                continue
            state = CardScheduleState()
            for _, correct, rating, created_at in attempts:
                rate = rating or ("medium" if correct else "hard")
                dt = created_at
                if isinstance(dt, str):
                    dt = datetime.fromisoformat(dt)
                state = schedule(state, rate, dt)

            conn.execute(
                sa.text(
                    "UPDATE flashcards "
                    "SET ease = :ease, interval_days = :interval_days, reps = :reps, "
                    "lapses = :lapses, due_at = :due_at, last_reviewed_at = :last_reviewed_at, "
                    "difficulty = :difficulty "
                    "WHERE id = :id"
                ),
                {
                    "id": cid,
                    "ease": state.ease,
                    "interval_days": state.interval_days,
                    "reps": state.reps,
                    "lapses": state.lapses,
                    "due_at": state.due_at,
                    "last_reviewed_at": state.last_reviewed_at,
                    "difficulty": state.difficulty,
                },
            )


def downgrade() -> None:
    op.drop_column("flashcard_attempts", "rating")
    op.drop_index("ix_flashcards_folder_id_due_at", table_name="flashcards")
    op.drop_column("flashcards", "last_reviewed_at")
    op.drop_column("flashcards", "due_at")
    op.drop_column("flashcards", "lapses")
    op.drop_column("flashcards", "reps")
    op.drop_column("flashcards", "interval_days")
    op.drop_column("flashcards", "ease")
