"""Custom mode: the answer input is set per question, not once per test."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.models.folder import Folder
from src.models.frq_answer import FRQAnswer
from src.models.question import Question
from src.models.test import Test as TestRow
from src.models.user import User
from src.schemas.attempt_schema import FRQGrade, SubmittedAnswer
from src.schemas.test_schema import QuestionCreate, QuestionUpdate
from src.services.grading_service import GradingService
from src.services.test_service import TestService as TestSvc
from src.utils.answer_input import is_custom_mode, question_modes
from src.utils.exceptions import ValidationException

pytestmark = pytest.mark.asyncio


def _q(**kw):
    return SimpleNamespace(answer_input=kw.get("answer_input"), code_language=kw.get("code_language"))


def _t(math=False, coding=False, language=None):
    return SimpleNamespace(is_math_mode=math, is_coding_mode=coding, coding_language=language)


async def test_question_without_input_keeps_the_test_mode() -> None:
    assert question_modes(_q(), _t(math=True)) == (True, False, "Python")
    assert question_modes(_q(), _t(coding=True, language="Java")) == (False, True, "Java")
    assert question_modes(_q(), _t()) == (False, False, "Python")


async def test_question_input_overrides_the_test_mode() -> None:
    # A math part inside a coding test, a text part inside a STEM test.
    assert question_modes(_q(answer_input="math"), _t(coding=True)) == (True, False, "Python")
    assert question_modes(_q(answer_input="text"), _t(math=True)) == (False, False, "Python")
    assert question_modes(_q(answer_input="code", code_language="Rust"), _t(language="Java")) == (False, True, "Rust")
    assert question_modes(_q(answer_input="code"), _t(language="Java")) == (False, True, "Java")


async def test_is_custom_mode() -> None:
    assert not is_custom_mode([_q(), _q()])
    assert is_custom_mode([_q(), _q(answer_input="text")])


async def _seed_custom(session):
    user = User(email="custom@example.com", google_id="g-custom", is_beta=True)
    session.add(user)
    await session.flush()
    folder = Folder(user_id=user.id, name="Physics")
    session.add(folder)
    await session.flush()
    # A general test whose three FRQs each ask for a different input.
    test = TestRow(folder_id=folder.id, title="Mixed", test_type="FRQ_only", coding_language="Java")
    session.add(test)
    await session.flush()
    text_q = Question(test_id=test.id, question_text="Explain inertia", question_type="FRQ", display_order=0,
                      answer_input="text")
    math_q = Question(test_id=test.id, question_text="Solve F = ma for a", question_type="FRQ", display_order=1,
                      answer_input="math")
    code_q = Question(test_id=test.id, question_text="Write velocity()", question_type="FRQ", display_order=2,
                      answer_input="code", code_language="Python")
    session.add_all([text_q, math_q, code_q])
    await session.flush()
    session.add_all([FRQAnswer(question_id=q.id, expected_answer="x") for q in (text_q, math_q, code_q)])
    await session.commit()
    return user, test, text_q, math_q, code_q


async def test_each_question_is_graded_by_its_own_input(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, test, text_q, math_q, code_q = await _seed_custom(session)
        service = GradingService(llm_service=AsyncMock())
        ok = FRQGrade(is_correct=True, feedback="ok", confidence=0.9)
        for name in ("grade_frq_answer", "grade_math_answer", "grade_code_answer"):
            setattr(service.llm_service, name, AsyncMock(return_value=ok))

        result = await service.submit_and_grade(
            test.id,
            user.id,
            [
                SubmittedAnswer(question_id=text_q.id, answer="it resists"),
                SubmittedAnswer(question_id=math_q.id, answer="a = F/m"),
                SubmittedAnswer(question_id=code_q.id, answer="def velocity(): ..."),
            ],
            session,
        )

    llm = service.llm_service
    assert llm.grade_frq_answer.await_count == 1
    assert llm.grade_math_answer.await_count == 1
    assert llm.grade_code_answer.await_count == 1
    assert llm.grade_code_answer.await_args.kwargs["language"] == "Python"  # question beats test (Java)
    by_id = {a.question_id: a for a in result.answers}
    assert by_id[math_q.id].is_math and not by_id[text_q.id].is_math and not by_id[code_q.id].is_math


async def test_take_payload_exposes_inputs_and_custom_flag(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, test, text_q, math_q, code_q = await _seed_custom(session)
        take = await TestSvc().get_test_for_taking(test.id, user.id, session)

    assert take.is_custom_mode
    inputs = {q.id: (q.answer_input, q.code_language) for q in take.questions}
    assert inputs == {text_q.id: ("text", None), math_q.id: ("math", None), code_q.id: ("code", "Python")}


async def test_add_and_update_question_inputs(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, test, *_ = await _seed_custom(session)
        service = TestSvc()
        added = await service.add_question(
            test.id, user.id,
            QuestionCreate(type="FRQ", question_text="Derive it", expected_answer="x", answer_input="math"),
            session,
        )
        assert added.answer_input == "math"

        changed = await service.update_question(
            added.id, user.id, QuestionUpdate(answer_input="code", code_language="Go"), session
        )
        assert (changed.answer_input, changed.code_language) == ("code", "Go")

        # Explicit null goes back to the test's mode and drops the language.
        cleared = await service.update_question(added.id, user.id, QuestionUpdate(answer_input=None), session)
        assert (cleared.answer_input, cleared.code_language) == (None, None)

        with pytest.raises(ValidationException):
            await service.add_question(
                test.id, user.id,
                QuestionCreate(type="FRQ", question_text="Bad", expected_answer="x", answer_input="choice"),
                session,
            )
        with pytest.raises(ValidationException):
            await service.update_question(
                added.id, user.id, QuestionUpdate(answer_input="text", code_language="Go"), session
            )
