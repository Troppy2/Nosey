"""System Design mode: quiz scoring and FRQ grading.

LLMService.grade_frq_answer is mocked in every test here. No real provider call
ever runs in this suite, and the scoring thresholds are asserted literally so
changing them has to be a deliberate edit to these tests.
"""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from src.models.system_design import SDQuizAttempt
from src.models.user import User
from src.repositories.system_design_repository import SystemDesignRepository
from src.schemas.attempt_schema import FRQGrade
from src.schemas.system_design_schema import (
    SDFrqSubmission,
    SDMcqResult,
    SDQuizGradeRequest,
)
from src.services.system_design_quiz_service import SystemDesignQuizService
from src.services.system_design_service import SystemDesignService
from src.utils.exceptions import LLMException, ValidationException

GRADER = "src.services.llm_service.LLMService.grade_frq_answer"


async def _make_user(session, email: str = "quiz@example.com") -> User:
    user = User(email=email, google_id=f"google-{email}")
    session.add(user)
    await session.commit()
    return user


def _request(mcq_correct: int = 3, frq_count: int = 5) -> SDQuizGradeRequest:
    mcq = [
        SDMcqResult(id=f"m{i}", chosen_index=0 if i < mcq_correct else 1, correct_index=0)
        for i in range(3)
    ]
    frq = [
        SDFrqSubmission(id=f"f{i}", prompt=f"Question {i}", rubric="A rubric line", answer="An answer")
        for i in range(frq_count)
    ]
    return SDQuizGradeRequest(notes="Caching notes", mcq=mcq, frq=frq)


def _grades(correct_count: int, total: int = 5) -> list[FRQGrade]:
    return [
        FRQGrade(is_correct=i < correct_count, feedback="ok", confidence=0.9)
        for i in range(total)
    ]


def _grader(grades: list[FRQGrade]) -> AsyncMock:
    return AsyncMock(side_effect=list(grades))


async def _grade(session, user_id: int, request: SDQuizGradeRequest, grader: AsyncMock):
    with patch(GRADER, new=grader):
        return await SystemDesignQuizService().grade(user_id, "caching", request, session)


@pytest.mark.parametrize("correct,expected", [(0, 0), (2, 67), (3, 100)])
async def test_mcq_score_is_the_percentage_correct(db_session_maker, correct, expected) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        response = await _grade(session, user.id, _request(mcq_correct=correct), _grader(_grades(5)))
        assert response.mcq_score == expected


@pytest.mark.parametrize("correct,expected", [(0, 0), (3, 60), (5, 100)])
async def test_frq_score_is_the_percentage_of_is_correct_grades(
    db_session_maker, correct, expected
) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        response = await _grade(session, user.id, _request(), _grader(_grades(correct)))
        assert response.frq_score == expected


async def test_total_score_weights_frq_at_sixty_percent(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)

        all_mcq = await _grade(session, user.id, _request(mcq_correct=3), _grader(_grades(0)))
        assert all_mcq.total_score == 40

        no_mcq = await _grade(session, user.id, _request(mcq_correct=0), _grader(_grades(5)))
        assert no_mcq.total_score == 60


@pytest.mark.parametrize(
    "mcq_correct,frq_correct,expected",
    [(3, 2, False), (2, 5, False), (3, 3, True)],
)
async def test_passed_requires_both_gates(
    db_session_maker, mcq_correct, frq_correct, expected
) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        response = await _grade(
            session, user.id, _request(mcq_correct=mcq_correct), _grader(_grades(frq_correct))
        )
        assert response.passed is expected


async def test_the_five_frqs_are_graded_concurrently(db_session_maker) -> None:
    async def slow_grade(**_kwargs):
        await asyncio.sleep(0.15)
        return FRQGrade(is_correct=True, feedback="ok", confidence=0.9)

    grader = AsyncMock(side_effect=slow_grade)
    async with db_session_maker() as session:
        user = await _make_user(session)
        started = time.monotonic()
        response = await _grade(session, user.id, _request(), grader)
        elapsed = time.monotonic() - started

    assert grader.await_count == 5
    assert response.frq_score == 100
    # Sequential would be at least 0.75s. Concurrent is one call's latency plus noise.
    assert elapsed < 0.5, f"grading took {elapsed:.2f}s, which looks sequential"


async def test_grading_is_not_wrapped_in_a_provider_loop(db_session_maker) -> None:
    """Each grade_frq_answer handles its own providers. Retrying here would nest
    a loop inside a loop and multiply quota use (CLAUDE.md, LLM rule 5)."""
    calls = {"count": 0}

    async def flaky(**_kwargs):
        calls["count"] += 1
        if calls["count"] <= 1:
            raise LLMException("first provider is rate limited")
        return FRQGrade(is_correct=True, feedback="ok", confidence=0.9)

    async with db_session_maker() as session:
        user = await _make_user(session)
        await _grade(session, user.id, _request(), AsyncMock(side_effect=flaky))

    assert calls["count"] == 5


async def test_a_request_without_exactly_five_frqs_is_rejected(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        with pytest.raises(ValidationException):
            await _grade(session, user.id, _request(frq_count=4), _grader(_grades(4)))


async def test_all_grades_flagged_uncertain_returns_grader_degraded(db_session_maker) -> None:
    ungradeable = [
        FRQGrade(is_correct=False, feedback="", flagged_uncertain=True, confidence=0.0)
        for _ in range(5)
    ]
    async with db_session_maker() as session:
        user = await _make_user(session)
        response = await _grade(session, user.id, _request(), _grader(ungradeable))

        assert response.grader_degraded is True
        assert response.passed is False
        attempts = (await session.execute(select(SDQuizAttempt))).scalars().all()
        assert len(attempts) == 1, "a degraded attempt is still recorded"


async def test_total_llm_outage_raises_and_persists_nothing(db_session_maker) -> None:
    grader = AsyncMock(side_effect=LLMException("every provider failed"))
    async with db_session_maker() as session:
        user = await _make_user(session)
        with pytest.raises(LLMException):
            await _grade(session, user.id, _request(), grader)

        assert (await session.execute(select(SDQuizAttempt))).scalars().all() == []


async def test_a_passing_attempt_flips_quiz_done_and_records_the_best_score(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        response = await _grade(session, user.id, _request(mcq_correct=3), _grader(_grades(5)))

        assert response.passed is True
        progress = (await SystemDesignRepository(session).get_progress(user.id))["caching"]
        assert progress.quiz_done is True
        assert progress.quiz_best_score == response.total_score


async def test_quiz_best_score_never_decreases(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        await _grade(session, user.id, _request(mcq_correct=3), _grader(_grades(5)))
        best = (await SystemDesignRepository(session).get_progress(user.id))["caching"].quiz_best_score

        await _grade(session, user.id, _request(mcq_correct=0), _grader(_grades(0)))
        assert (
            await SystemDesignRepository(session).get_progress(user.id)
        )["caching"].quiz_best_score == best


async def test_quiz_done_is_never_unset_by_a_later_failing_attempt(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        await _grade(session, user.id, _request(mcq_correct=3), _grader(_grades(5)))
        await _grade(session, user.id, _request(mcq_correct=0), _grader(_grades(0)))

        assert (await SystemDesignRepository(session).get_progress(user.id))["caching"].quiz_done is True


async def test_a_passing_quiz_that_completes_the_concept_sets_completed_at(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        service = SystemDesignService()
        for sub_module in ("notes", "video", "visualizer", "project"):
            await service.mark_sub_module(user.id, "caching", sub_module, True, session)

        response = await _grade(session, user.id, _request(mcq_correct=3), _grader(_grades(5)))

        assert response.concept_completed is True
        assert (await SystemDesignRepository(session).get_progress(user.id))["caching"].completed_at is not None


async def test_attempts_are_append_only(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        await _grade(session, user.id, _request(mcq_correct=3), _grader(_grades(5)))
        await _grade(session, user.id, _request(mcq_correct=1), _grader(_grades(1)))

        attempts = (await session.execute(select(SDQuizAttempt))).scalars().all()
        assert len(attempts) == 2


async def test_frq_feedback_is_returned_per_question(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        request = _request()
        response = await _grade(session, user.id, request, _grader(_grades(3)))

        assert [item.id for item in response.frq_feedback] == [item.id for item in request.frq]
        assert [item.is_correct for item in response.frq_feedback] == [True, True, True, False, False]
