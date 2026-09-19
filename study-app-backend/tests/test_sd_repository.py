"""System Design mode: the DB access layer.

Real in-memory SQLite (db_session_maker), never a mocked session: these assert
the queries and the JSON round trip, both of which a mock would hide.
"""
from __future__ import annotations

from src.models.user import User
from src.repositories.system_design_repository import SystemDesignRepository


async def _make_user(session, email: str) -> User:
    user = User(email=email, google_id=f"google-{email}")
    session.add(user)
    await session.commit()
    return user


async def test_get_progress_returns_empty_dict_for_new_user(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "new@example.com")
        assert await SystemDesignRepository(session).get_progress(user.id) == {}


async def test_upsert_progress_creates_then_updates_the_same_row(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "upsert@example.com")
        repo = SystemDesignRepository(session)

        await repo.upsert_progress(user.id, "caching", notes_done=True)
        await session.commit()
        await repo.upsert_progress(user.id, "caching", notes_done=False, video_done=True)
        await session.commit()

        progress = await repo.get_progress(user.id)
        assert list(progress) == ["caching"]
        assert progress["caching"].notes_done is False
        assert progress["caching"].video_done is True


async def test_get_submission_returns_none_when_absent(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "absent@example.com")
        assert await SystemDesignRepository(session).get_submission(user.id, "caching:visualizer") is None


async def test_upsert_submission_round_trips_files_json(db_session_maker) -> None:
    files = {
        "cache.py": "class Cache:\n    # rendez-vous, \u00e9viction, \u4f7f\u7528\n    pass\n",
        "helpers.py": "TAB = '\\t'\n",
    }
    async with db_session_maker() as session:
        user = await _make_user(session, "files@example.com")
        repo = SystemDesignRepository(session)

        await repo.upsert_submission(user.id, "caching:visualizer", files=files)
        await session.commit()

        row = await repo.get_submission(user.id, "caching:visualizer")
        assert row is not None
        assert repo.load_files(row) == files


async def test_upsert_submission_updates_the_same_row(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "resave@example.com")
        repo = SystemDesignRepository(session)

        await repo.upsert_submission(user.id, "caching:project", files={"a.py": "1"})
        await session.commit()
        await repo.upsert_submission(user.id, "caching:project", files={"a.py": "2"})
        await session.commit()

        row = await repo.get_submission(user.id, "caching:project")
        assert row is not None
        assert repo.load_files(row) == {"a.py": "2"}


async def test_load_files_tolerates_corrupt_json(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "corrupt@example.com")
        repo = SystemDesignRepository(session)
        await repo.upsert_submission(user.id, "caching:project", files={"a.py": "1"})
        await session.commit()

        row = await repo.get_submission(user.id, "caching:project")
        assert row is not None
        row.files_json = "{not json"
        assert repo.load_files(row) == {}


async def test_progress_is_scoped_to_the_requesting_user(db_session_maker) -> None:
    async with db_session_maker() as session:
        user_a = await _make_user(session, "a@example.com")
        user_b = await _make_user(session, "b@example.com")
        repo = SystemDesignRepository(session)

        await repo.upsert_progress(user_a.id, "caching", notes_done=True)
        await session.commit()

        assert list(await repo.get_progress(user_a.id)) == ["caching"]
        assert await repo.get_progress(user_b.id) == {}
        assert await repo.get_submission(user_b.id, "caching:visualizer") is None


async def test_add_quiz_attempt_appends(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "quiz@example.com")
        repo = SystemDesignRepository(session)

        await repo.add_quiz_attempt(
            user_id=user.id,
            concept_id="caching",
            mcq_answers=[{"id": "m1", "chosenIndex": 0, "correct": True}],
            frq_answers=[{"id": "f1", "answer": "a write-through cache"}],
            frq_grades=[{"id": "f1", "is_correct": True}],
            mcq_score=100,
            frq_score=100,
            total_score=100,
            passed=True,
        )
        await session.commit()
        await repo.add_quiz_attempt(
            user_id=user.id,
            concept_id="caching",
            mcq_answers=[],
            frq_answers=[],
            frq_grades=[],
            mcq_score=0,
            frq_score=0,
            total_score=0,
            passed=False,
        )
        await session.commit()

        attempts = await repo.list_quiz_attempts(user.id, "caching")
        assert len(attempts) == 2
