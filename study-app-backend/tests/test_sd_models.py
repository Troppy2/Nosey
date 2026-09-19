"""System Design mode: ORM mapping, uniqueness constraints, and cascade behavior.

These use a real (in-memory SQLite) database via the db_session_maker fixture
rather than a mocked session: the point of every test here is to verify the SQL
and the constraints the models declare, which a mock would only re-describe.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from src.models.system_design import SDConceptProgress, SDQuizAttempt, SDSubmission
from src.models.user import User


async def _make_user(session, email: str = "sd@example.com") -> User:
    user = User(email=email, google_id=f"google-{email}")
    session.add(user)
    await session.commit()
    return user


async def test_progress_row_unique_per_user_and_concept(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        session.add(SDConceptProgress(user_id=user.id, concept_id="caching"))
        await session.commit()

        session.add(SDConceptProgress(user_id=user.id, concept_id="caching"))
        with pytest.raises(IntegrityError):
            await session.commit()


async def test_submission_unique_per_user_and_exercise(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        session.add(SDSubmission(user_id=user.id, exercise_id="caching:visualizer"))
        await session.commit()

        session.add(SDSubmission(user_id=user.id, exercise_id="caching:visualizer"))
        with pytest.raises(IntegrityError):
            await session.commit()


async def test_progress_booleans_default_false(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        session.add(SDConceptProgress(user_id=user.id, concept_id="caching"))
        await session.commit()

        row = (
            await session.execute(select(SDConceptProgress).where(SDConceptProgress.user_id == user.id))
        ).scalar_one()
        assert row.notes_done is False
        assert row.video_done is False
        assert row.visualizer_done is False
        assert row.project_done is False
        assert row.quiz_done is False
        assert row.quiz_best_score is None
        assert row.completed_at is None


async def test_submission_defaults_to_empty_files_and_not_passed(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        session.add(SDSubmission(user_id=user.id, exercise_id="caching:project"))
        await session.commit()

        row = (
            await session.execute(select(SDSubmission).where(SDSubmission.user_id == user.id))
        ).scalar_one()
        assert row.files_json == "{}"
        assert row.last_run_passed is False
        assert row.passed_at is None


async def test_deleting_user_cascades_all_three_tables(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        session.add_all(
            [
                SDConceptProgress(user_id=user.id, concept_id="caching"),
                SDSubmission(user_id=user.id, exercise_id="caching:visualizer"),
                SDQuizAttempt(user_id=user.id, concept_id="caching"),
            ]
        )
        await session.commit()

        loaded = (
            await session.execute(
                select(User)
                .where(User.id == user.id)
                .options(
                    selectinload(User.sd_concept_progress),
                    selectinload(User.sd_submissions),
                    selectinload(User.sd_quiz_attempts),
                )
            )
        ).scalar_one()
        await session.delete(loaded)
        await session.commit()

        assert (await session.execute(select(SDConceptProgress))).scalars().all() == []
        assert (await session.execute(select(SDSubmission))).scalars().all() == []
        assert (await session.execute(select(SDQuizAttempt))).scalars().all() == []


async def test_quiz_attempts_are_not_unique_constrained(db_session_maker) -> None:
    """Attempts are append-only history: two for the same concept both persist."""
    async with db_session_maker() as session:
        user = await _make_user(session)
        session.add_all(
            [
                SDQuizAttempt(user_id=user.id, concept_id="caching", total_score=40),
                SDQuizAttempt(user_id=user.id, concept_id="caching", total_score=90),
            ]
        )
        await session.commit()

        rows = (await session.execute(select(SDQuizAttempt))).scalars().all()
        assert len(rows) == 2


async def test_models_are_mappable() -> None:
    from sqlalchemy.orm import configure_mappers

    import src.main  # noqa: F401  (imports every model through the app)

    configure_mappers()
