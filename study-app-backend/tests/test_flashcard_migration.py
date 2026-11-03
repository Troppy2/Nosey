from __future__ import annotations

import importlib
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

mig = importlib.import_module("src.migrations.versions.078_flashcards_spaced_repetition")


def test_migration_078_upgrade_and_downgrade():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        db_path = tmp.name

    clean_path = db_path.replace("\\", "/")
    db_url = f"sqlite:///{clean_path}"
    engine = create_engine(db_url)

    now = datetime(2026, 11, 2, 12, 0, 0)
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")

    # Set up tables as they exist at migration 077
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE users ("
            "id INTEGER PRIMARY KEY, "
            "email VARCHAR(255) NOT NULL, "
            "google_id VARCHAR(255) NOT NULL, "
            "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            ")"
        ))
        conn.execute(text(
            "CREATE TABLE folders ("
            "id INTEGER PRIMARY KEY, "
            "user_id INTEGER NOT NULL, "
            "name VARCHAR(120) NOT NULL, "
            "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            ")"
        ))
        conn.execute(text(
            "CREATE TABLE flashcards ("
            "id INTEGER PRIMARY KEY, "
            "folder_id INTEGER NOT NULL, "
            "front TEXT NOT NULL, "
            "back TEXT NOT NULL, "
            "source VARCHAR(50), "
            "difficulty INTEGER DEFAULT 1 NOT NULL, "
            "topic VARCHAR(80), "
            "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            ")"
        ))
        conn.execute(text(
            "CREATE TABLE flashcard_attempts ("
            "id INTEGER PRIMARY KEY, "
            "user_id INTEGER NOT NULL, "
            "flashcard_id INTEGER NOT NULL, "
            "correct BOOLEAN NOT NULL, "
            "time_ms INTEGER, "
            "attempt_number INTEGER, "
            "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
            "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            ")"
        ))

        # Insert seed data
        conn.execute(text("INSERT INTO users (id, email, google_id) VALUES (1, 'u@example.com', 'g-1')"))
        conn.execute(text("INSERT INTO folders (id, user_id, name) VALUES (1, 1, 'Folder 1')"))
        conn.execute(text(
            f"INSERT INTO flashcards (id, folder_id, front, back, difficulty, created_at, updated_at) "
            f"VALUES (10, 1, 'Front 10', 'Back 10', 1, '{now_str}', '{now_str}')"
        ))
        conn.execute(text(
            f"INSERT INTO flashcards (id, folder_id, front, back, difficulty, created_at, updated_at) "
            f"VALUES (20, 1, 'Front 20 (new)', 'Back 20', 1, '{now_str}', '{now_str}')"
        ))

        t1 = (now - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
        t2 = now_str
        conn.execute(text(
            f"INSERT INTO flashcard_attempts (user_id, flashcard_id, correct, created_at, updated_at) "
            f"VALUES (1, 10, 1, '{t1}', '{t1}')"
        ))
        conn.execute(text(
            f"INSERT INTO flashcard_attempts (user_id, flashcard_id, correct, created_at, updated_at) "
            f"VALUES (1, 10, 0, '{t2}', '{t2}')"
        ))

    # Run upgrade
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        mig.op._proxy = Operations(ctx)
        mig.upgrade()

    # Verify upgrade results
    with engine.begin() as conn:
        row10 = conn.execute(text(
            "SELECT ease, interval_days, reps, lapses, due_at, last_reviewed_at, difficulty "
            "FROM flashcards WHERE id = 10"
        )).fetchone()
        assert row10 is not None
        # Card 10: attempt 1 (medium) -> reps 1, ease 2.45
        # attempt 2 (hard) -> lapses 1, reps 0, interval 0, ease 2.25, due = now + 10m
        assert row10[0] == pytest.approx(2.25, abs=1e-2)
        assert row10[1] == 0  # interval_days
        assert row10[2] == 0  # reps
        assert row10[3] == 1  # lapses
        assert row10[4] is not None  # due_at
        assert row10[5] is not None  # last_reviewed_at
        assert row10[6] == 3  # difficulty: 1 + 1 + (2.5 - 2.25)*4 = 3

        row20 = conn.execute(text(
            "SELECT ease, interval_days, reps, lapses, due_at, last_reviewed_at "
            "FROM flashcards WHERE id = 20"
        )).fetchone()
        assert row20 is not None
        assert row20[0] == pytest.approx(2.5, abs=1e-2)
        assert row20[1] == 0
        assert row20[2] == 0
        assert row20[3] == 0
        assert row20[4] is None  # due_at is None for New
        assert row20[5] is None

        # Attempts rating backfilled
        ratings = conn.execute(text("SELECT rating FROM flashcard_attempts ORDER BY id")).fetchall()
        assert [r[0] for r in ratings] == ["medium", "hard"]

        indexes = [r[1] for r in conn.execute(text("PRAGMA index_list(flashcards)")).fetchall()]
        assert "ix_flashcards_folder_id_due_at" in indexes

    # Run downgrade
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        mig.op._proxy = Operations(ctx)
        mig.downgrade()

    # Verify downgrade dropped columns
    with engine.begin() as conn:
        cols = [c[1] for c in conn.execute(text("PRAGMA table_info(flashcards)")).fetchall()]
        assert "ease" not in cols
        assert "due_at" not in cols
        assert "interval_days" not in cols
        assert "reps" not in cols
        assert "lapses" not in cols
        assert "last_reviewed_at" not in cols

        indexes = [r[1] for r in conn.execute(text("PRAGMA index_list(flashcards)")).fetchall()]
        assert "ix_flashcards_folder_id_due_at" not in indexes

        attempt_cols = [c[1] for c in conn.execute(text("PRAGMA table_info(flashcard_attempts)")).fetchall()]
        assert "rating" not in attempt_cols

    engine.dispose()
    Path(db_path).unlink(missing_ok=True)
