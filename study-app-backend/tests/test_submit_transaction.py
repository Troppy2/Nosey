"""Submit holds no DB transaction while grading.

OCR + grading can take minutes. The submit used to keep its transaction open
the whole time; Neon closed the idle connection and the final INSERT failed
with "server closed the connection unexpectedly", throwing away the grading.
Now: read, commit, grade with no connection, then one short write.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from src.models.user_attempt import UserAttempt
from src.repositories.attempt_repository import AttemptRepository
from src.schemas.attempt_schema import DraftAttemptAnswer, FRQGrade, SubmittedAnswer
from tests.test_ocr_redo import _seed, _service

pytestmark = pytest.mark.asyncio


async def test_grading_runs_outside_a_transaction(db_session_maker, monkeypatch) -> None:
    async with db_session_maker() as session:
        user, test, frq, mcq = await _seed(session)
        service = _service(monkeypatch, [])
        seen: list[bool] = []

        async def grade(*args, **kwargs):
            seen.append(session.in_transaction())
            return FRQGrade(is_correct=True, feedback="Nice", confidence=0.9)

        service.llm_service.grade_math_answer.side_effect = grade
        result = await service.submit_and_grade(
            test.id, user.id, [SubmittedAnswer(question_id=frq.id, answer="x = 4")], session
        )

    assert result.correct_count == 1
    assert seen and not any(seen)


async def test_submit_replaces_draft_with_submitted_attempt(db_session_maker, monkeypatch) -> None:
    async with db_session_maker() as session:
        user, test, frq, mcq = await _seed(session)
        service = _service(monkeypatch, [])
        await service.save_draft_attempt(
            test.id, user.id, [DraftAttemptAnswer(question_id=frq.id, user_answer="x = 4")], session
        )
        result = await service.submit_and_grade(
            test.id, user.id, [SubmittedAnswer(question_id=frq.id, answer="x = 4")], session
        )
        attempts = (await session.scalars(select(UserAttempt))).all()

    assert [a.status for a in attempts] == ["submitted"]
    assert attempts[0].id == result.attempt_id
    assert result.attempt_number == 1


async def test_write_retries_once_on_dropped_connection(db_session_maker, monkeypatch) -> None:
    async with db_session_maker() as session:
        user, test, frq, mcq = await _seed(session)
        service = _service(monkeypatch, [])
        real = AttemptRepository.next_attempt_number
        calls = {"n": 0}

        async def flaky(self, user_id, test_id):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OperationalError("INSERT", {}, Exception("server closed the connection"))
            return await real(self, user_id, test_id)

        monkeypatch.setattr(AttemptRepository, "next_attempt_number", flaky)
        result = await service.submit_and_grade(
            test.id, user.id, [SubmittedAnswer(question_id=frq.id, answer="x = 4")], session
        )

    assert calls["n"] == 2
    assert result.correct_count == 1
    assert service.llm_service.grade_math_answer.await_count == 1  # grading not redone
