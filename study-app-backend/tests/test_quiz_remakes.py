"""Quiz remakes: one remake per wrong answer for half credit (spec-quiz-remakes.md)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from src.models.folder import Folder
from src.models.question import Question
from src.models.test import Test as TestModel
from src.models.user import User
from src.repositories.test_repository import TestRepository as Repo, add_generated_questions
from src.schemas.attempt_schema import (
    FeedbackSections,
    FRQGrade,
    RemakeAppealRequest,
    RemakeRequest,
    SubmittedAnswer,
)
from src.services.grading_service import GradingService
from src.services.llm_service import GeneratedFRQ, GeneratedMCQ, RemakeGrade
from src.utils.exceptions import LLMException, ValidationException

pytestmark = pytest.mark.asyncio

_FIX = FeedbackSections(what_to_fix="You took the lower tail.", final_answer="$$0.0228$$")


def _remake_grade(credited: bool) -> RemakeGrade:
    return RemakeGrade(
        credited=credited,
        answer_correct=credited,
        reflection_ok=credited,
        sections=FeedbackSections(note="Checked.", final_answer="$$0.0228$$"),
        confidence=0.9,
    )


async def _setup(session):
    user = User(email="remake@example.com", google_id="g-remake")
    session.add(user)
    await session.flush()
    folder = Folder(user_id=user.id, name="Stats")
    session.add(folder)
    await session.flush()
    test = TestModel(folder_id=folder.id, title="T", test_type="mixed", is_math_mode=True)
    session.add(test)
    await session.flush()
    await add_generated_questions(
        Repo(session),
        test.id,
        [GeneratedMCQ("Which needs a correction?", ["Binomial count", "Normal X"], 0)],
        [GeneratedFRQ("Find P(Z>2).", "0.0228"), GeneratedFRQ("Find P(Z<1).", "0.8413")],
        1,
    )
    await session.commit()
    questions = list(await session.scalars(select(Question).order_by(Question.display_order)))
    by_type = {"mcq": next(q for q in questions if q.question_type == "MCQ")}
    frqs = [q for q in questions if q.question_type == "FRQ"]
    by_type["wrong"], by_type["right"] = frqs[0], frqs[1]

    service = GradingService(llm_service=AsyncMock())

    async def grade_math(**kwargs):
        right = "P(Z<1)" in kwargs["question"]
        return FRQGrade(is_correct=right, feedback="**What to fix:** lower tail", confidence=0.9,
                        sections=None if right else _FIX)

    service.llm_service.grade_math_answer = AsyncMock(side_effect=grade_math)
    service.llm_service.explain_objective_answer = AsyncMock(
        return_value=type("R", (), {"feedback": "", "reasoning": None, "answer_key_ok": True,
                                    "actual_correct_answer": None, "sections": None})()
    )
    result = await service.submit_and_grade(test.id, user.id, [
        SubmittedAnswer(question_id=by_type["mcq"].id, answer="Normal X"),
        SubmittedAnswer(question_id=by_type["wrong"].id, answer="0.9772"),
        SubmittedAnswer(question_id=by_type["right"].id, answer="0.8413"),
    ], session)
    return user, test, by_type, service, result


def _body(answer: str = "0.0228", wrong: str = "I used the lower tail.") -> RemakeRequest:
    return RemakeRequest(answer=answer, what_wrong=wrong, what_right="The z value was right.")


async def test_a_wrong_answer_hides_the_key_until_the_remake(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, _, q, service, result = await _setup(session)
        wrong = next(a for a in result.answers if a.question_id == q["wrong"].id)
        assert wrong.remake_available and wrong.correct_answer is None
        assert wrong.feedback_sections == FeedbackSections(what_to_fix="You took the lower tail.")
        mcq = next(a for a in result.answers if a.question_id == q["mcq"].id)
        assert mcq.remake_available and mcq.correct_answer is None and mcq.options == ["Binomial count", "Normal X"]
        right = next(a for a in result.answers if a.question_id == q["right"].id)
        assert not right.remake_available and right.correct_answer == "0.8413"

        # The user's own MCP agent still sees the key; Kojo in the app does not.
        full = await service.get_attempt_detail(result.attempt_id, user.id, session, reveal_key=True)
        assert next(a for a in full.answers if a.question_id == q["wrong"].id).correct_answer == "0.0228"


async def test_a_credited_remake_gives_half_a_point(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, test, q, service, result = await _setup(session)
        service.llm_service.grade_remake = AsyncMock(return_value=_remake_grade(True))
        response = await service.remake_answer(result.attempt_id, q["wrong"].id, user.id, _body(), session)
        assert response.answer.remake_status == "credited"
        assert response.answer.correct_answer == "0.0228"  # unlocked
        assert response.score == pytest.approx(33.33, abs=0.01)
        assert response.remake_score == pytest.approx(50.0)  # (1 + 0.5) / 3

        tests = await Repo(session).list_by_folder(test.folder_id, user.id)
        assert float(tests[0][2]) == pytest.approx(50.0)  # best score uses the remake score

        with pytest.raises(ValidationException):
            await service.remake_answer(result.attempt_id, q["wrong"].id, user.id, _body(), session)


async def test_multiple_choice_remake_is_checked_against_the_key(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, _, q, service, result = await _setup(session)
        service.llm_service.grade_remake = AsyncMock(return_value=_remake_grade(True))
        await service.remake_answer(result.attempt_id, q["mcq"].id, user.id, _body("Binomial count"), session)
        assert service.llm_service.grade_remake.await_args.kwargs["answer_correct"] is True


async def test_appeal_only_after_no_credit_and_only_once(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, _, q, service, result = await _setup(session)
        reason = RemakeAppealRequest(reason="Line 3 says 1 - 0.9772.")
        with pytest.raises(ValidationException):
            await service.appeal_remake(result.attempt_id, q["wrong"].id, user.id, reason, session)

        service.llm_service.grade_remake = AsyncMock(return_value=_remake_grade(False))
        response = await service.remake_answer(result.attempt_id, q["wrong"].id, user.id, _body("0.9772"), session)
        assert response.answer.remake_status == "no_credit" and response.remake_score is None

        service.llm_service.grade_remake = AsyncMock(return_value=_remake_grade(True))
        response = await service.appeal_remake(result.attempt_id, q["wrong"].id, user.id, reason, session)
        assert response.answer.remake_status == "credited" and response.answer.remake_appeal_status == "credited"
        assert service.llm_service.grade_remake.await_args.kwargs["appeal_reason"] == reason.reason
        with pytest.raises(ValidationException):
            await service.appeal_remake(result.attempt_id, q["wrong"].id, user.id, reason, session)


async def test_show_answer_gives_up_the_remake(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, _, q, service, result = await _setup(session)
        response = await service.reveal_answer(result.attempt_id, q["wrong"].id, user.id, session)
        assert response.answer.answer_revealed and response.answer.correct_answer == "0.0228"
        assert not response.answer.remake_available
        with pytest.raises(ValidationException):
            await service.remake_answer(result.attempt_id, q["wrong"].id, user.id, _body(), session)


async def test_a_failed_grade_writes_nothing(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, _, q, service, result = await _setup(session)
        service.llm_service.grade_remake = AsyncMock(side_effect=LLMException("down"))
        with pytest.raises(LLMException):
            await service.remake_answer(result.attempt_id, q["wrong"].id, user.id, _body(), session)
        detail = await service.get_attempt_detail(result.attempt_id, user.id, session)
        assert next(a for a in detail.answers if a.question_id == q["wrong"].id).remake_available


async def test_remake_needs_both_reflections() -> None:
    with pytest.raises(ValueError):
        RemakeRequest(answer="1", what_wrong="", what_right="x")
