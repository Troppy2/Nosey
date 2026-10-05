"""Grading sees the earlier questions a question builds on (GH #155)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from src.models.folder import Folder
from src.models.frq_answer import FRQAnswer
from src.models.question import Question
from src.models.question_group import QuestionGroup
from src.models.test import Test
from src.models.user import User
from src.schemas.attempt_schema import FRQGrade, OcrResult, RedoAnswerRequest, SubmittedAnswer
from src.services.grading_service import GradingService, related_context, related_questions
from src.services.llm_service import _related_questions_block

_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


def _q(qid: int, text: str, group_id=None, part=None) -> SimpleNamespace:
    return SimpleNamespace(id=qid, question_text=text, group_id=group_id, part_label=part, display_order=qid)


def test_a_part_builds_on_every_earlier_part_of_its_problem() -> None:
    a, b, c = _q(1, "Find c.", 7, "a"), _q(2, "Find f_X.", 7, "b"), _q(3, "Find P(X<1/2).", 7, "c")
    other = _q(4, "Unrelated.")
    assert related_questions(c, [a, b, c, other]) == [a, b]
    assert related_questions(a, [a, b, c, other]) == []


def test_text_references_point_back_to_earlier_questions_only() -> None:
    q1, q2 = _q(1, "Find the mean."), _q(2, "Find the variance.")
    q3 = _q(3, "Using your answer to Q1, standardise x = 5.")
    q4 = _q(4, "Use question 5 later.")
    ordered = [q1, q2, q3, q4]
    assert related_questions(q3, ordered) == [q1]
    assert related_questions(q4, ordered) == []  # a forward reference is ignored
    prev = _q(5, "Using the previous question, ...")
    assert related_questions(prev, [*ordered, prev]) == [q4]


def test_part_reference_in_an_ungrouped_test_finds_the_labelled_question() -> None:
    a = _q(1, "(a) Find the constant c.")
    b = _q(2, "(b) Find the marginal of X.")
    c = _q(3, "(c) Using part (a), compute P(X + Y < 1/2).")
    assert related_questions(c, [a, b, c]) == [a]


def test_context_carries_answers_and_same_problem_verdicts() -> None:
    a, b = _q(1, "Find c.", 7, "a"), _q(2, "Find f_X.", 7, "b")
    ctx = related_context(b, [a, b], {1: "c = 6"}, {1: False})
    assert "Question 1, part (a): Find c." in ctx
    assert "Student's answer: c = 6" in ctx and "Graded: wrong" in ctx
    q1, q2 = _q(1, "Find the mean."), _q(2, "Using Q1, find z.")
    assert "Graded" not in related_context(q2, [q1, q2], {1: "5"}, {1: True})  # other lanes: no verdict


def test_prompt_block_is_delimited_and_states_the_carry_forward_rule() -> None:
    assert _related_questions_block("") == ""
    block = _related_questions_block("Question 1: Find c.\nStudent's answer: c = 6")
    assert "<<<BEGIN EARLIER QUESTIONS>>>" in block and "UNTRUSTED" in block
    assert "CARRY-FORWARD RULE" in block


async def _seed(session):
    user = User(email="related@example.com", google_id="g-related", is_beta=True)
    session.add(user)
    await session.flush()
    folder = Folder(user_id=user.id, name="Stats")
    session.add(folder)
    await session.flush()
    test = Test(folder_id=folder.id, title="HW", test_type="FRQ_only", is_math_mode=True)
    session.add(test)
    await session.flush()
    group = QuestionGroup(test_id=test.id, label="3", stem="f(x, y) = c(x + y) on x, y > 0, x + y < 1.", display_order=0)
    session.add(group)
    await session.flush()
    parts = []
    for order, (label, text, key) in enumerate([("a", "Find c.", "c = 3"), ("b", "Find f_X.", "3(1-x^2)/2"), ("c", "Find P(X < 1/2).", "11/16")]):
        q = Question(test_id=test.id, question_text=text, question_type="FRQ", display_order=order, group_id=group.id, part_label=label)
        session.add(q)
        await session.flush()
        session.add(FRQAnswer(question_id=q.id, expected_answer=key))
        parts.append(q)
    await session.commit()
    return user, test, parts


def _service(grades: list[bool]) -> GradingService:
    service = GradingService(llm_service=AsyncMock())
    queue = list(grades)
    service.llm_service.grade_math_answer = AsyncMock(
        side_effect=lambda **kw: FRQGrade(is_correct=queue.pop(0), feedback="f", confidence=0.9)
    )
    return service


async def test_parts_grade_in_order_and_later_parts_see_earlier_verdicts(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, test, (a, b, c) = await _seed(session)
        service = _service([False, True, True])
        await service.submit_and_grade(
            test.id, user.id,
            [SubmittedAnswer(question_id=q.id, answer=ans) for q, ans in ((c, "p"), (a, "c = 6"), (b, "fx"))],
            session,
        )
        calls = service.llm_service.grade_math_answer.await_args_list
        sent = [call.kwargs["question"].rsplit("\n\n", 1)[-1] for call in calls]
        assert sent == ["(a) Find c.", "(b) Find f_X.", "(c) Find P(X < 1/2)."]
        assert calls[0].kwargs["related_context"] == ""
        last = calls[2].kwargs["related_context"]
        assert "c = 6" in last and "Graded: wrong" in last and "Graded: correct" in last


async def test_redoing_a_held_part_regrades_the_later_parts(db_session_maker, monkeypatch) -> None:
    async with db_session_maker() as session:
        user, test, (a, b, c) = await _seed(session)
        service = _service([True, True, True, True, True])
        reads = [None, OcrResult(transcript="$c = 3$", confidence=0.9, engine="claude")]
        monkeypatch.setattr(service.ocr_service, "transcribe", AsyncMock(side_effect=lambda *x, **k: reads.pop(0)))
        result = await service.submit_and_grade(
            test.id, user.id,
            [
                SubmittedAnswer(question_id=a.id, answer="", work_image=_PNG_B64),
                SubmittedAnswer(question_id=b.id, answer="fx"),
                SubmittedAnswer(question_id=c.id, answer="p"),
            ],
            session,
        )
        assert result.is_provisional
        first_b = service.llm_service.grade_math_answer.await_args_list[0].kwargs["related_context"]
        assert "could not be read yet" in first_b

        redo = await service.redo_answer(result.attempt_id, a.id, user.id, RedoAnswerRequest(work_image=_PNG_B64), session)
        assert [ans.question_id for ans in redo.answers] == [a.id, b.id, c.id]
        regraded_b = service.llm_service.grade_math_answer.await_args_list[-2].kwargs["related_context"]
        assert "$c = 3$" in regraded_b and "Graded: correct" in regraded_b
        assert redo.score == 100.0
