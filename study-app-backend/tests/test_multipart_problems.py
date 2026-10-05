"""Multi-part practice problems (GH #151).

A problem with lettered parts is one group: the setup stored once, each part
its own question, saved in document order across MCQ and FRQ, and every LLM
call that reads a part gets the setup too.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from src.models.folder import Folder
from src.models.question import Question, full_question_text
from src.models.question_group import QuestionGroup
from src.models.test import Test as TestModel
from src.models.user import User
from src.repositories.test_repository import TestRepository as Repo, add_generated_questions
from src.routes.tests import _reviewed_questions_from_form
from src.schemas.attempt_schema import FRQGrade, SubmittedAnswer
from src.schemas.test_schema import QuestionGroupUpdate
from src.services.grading_service import GradingService
from src.services.llm_service import (
    GeneratedFRQ,
    GeneratedMCQ,
    LLMService,
    _attach_practice_groups,
    _drop_mcq_twins,
    _is_near_duplicate,
    _practice_identity,
    _practice_norm,
    practice_full_text,
    practice_part_label,
)
from src.services.test_service import TestService as Service

pytestmark = pytest.mark.asyncio

SETUP = r"Let $A = \begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}$."


def _picker_entry() -> dict:
    return {
        "problem": 0,
        "setup": SETUP,
        "mcq": [{"n": 2, "part": "(b)", "question_text": "Is $A$ invertible?", "options": ["Yes", "No"],
                 "correct_index": 0, "answer_from_document": True}],
        "frq": [
            {"n": 1, "part": "a", "question_text": "Find $\\det A$.", "expected_answer": "-2",
             "answer_from_document": True},
            {"n": 3, "part": "c", "question_text": "Find $A^{-1}$.", "expected_answer": "...",
             "answer_from_document": False},
        ],
    }


async def test_part_labels_are_normalized() -> None:
    assert practice_part_label("(b)") == "b"
    assert practice_part_label("A") == "a"
    assert practice_part_label("ii") == "ii"
    assert practice_part_label("") is None
    assert practice_part_label("Problem 3") is None


async def test_a_picked_problem_becomes_one_group_in_document_order() -> None:
    mcq, frq = LLMService()._practice_group_entry(_picker_entry(), 4, "2.3")
    parts = sorted([*mcq, *frq], key=lambda q: q.seq)
    assert [q.part_label for q in parts] == ["a", "b", "c"]
    assert {q.group_key for q in parts} == {"p4:2.3"}
    assert all(q.group_stem == SETUP and q.group_label == "2.3" for q in parts)
    # The setup is not repeated in the part, but every reader of the part gets it.
    assert "bmatrix" not in parts[0].question_text
    assert practice_full_text(parts[0]).startswith(SETUP)
    assert practice_full_text(parts[0]).endswith("(a) Find $\\det A$.")


async def test_a_problem_without_parts_stays_ungrouped() -> None:
    entry = {"setup": "", "frq": [{"n": 1, "part": "", "question_text": "Define rank.", "expected_answer": "x"}]}
    _, frq = LLMService()._practice_group_entry(entry, 0, "1")
    assert frq[0].group_key is None and frq[0].part_label is None
    assert practice_full_text(frq[0]) == "Define rank."


async def test_same_part_of_two_problems_is_not_a_duplicate() -> None:
    """Problem 2's "(a) Find the rank" must not be dropped as a copy of problem 1's."""
    first = _attach_practice_groups(
        [GeneratedFRQ("Find the rank.", "2", part_label="a", group_label="1")],
        "d:", {"1": "Let $A = I_2$."},
    )[0]
    second = _attach_practice_groups(
        [GeneratedFRQ("Find the rank.", "3", part_label="a", group_label="2")],
        "d:", {"2": "Let $B = I_3$."},
    )[0]
    assert not _is_near_duplicate(_practice_identity(second), [_practice_norm(_practice_identity(first))])
    mcq = [GeneratedMCQ("Find the rank.", ["1", "2"], 0, part_label="a", group_key="d:2", group_label="2",
                        group_stem="Let $B = I_3$.")]
    assert _drop_mcq_twins(mcq, [first]) == mcq


async def test_reviewed_drafts_keep_their_group_and_order() -> None:
    raw = json.dumps([
        {"kind": "frq", "question_text": "Find det.", "expected_answer": "-2", "part_label": "a",
         "group_key": "p0:1", "group_label": "1", "group_stem": SETUP},
        {"kind": "mcq", "question_text": "Invertible?", "options": ["Yes", "No"], "correct_index": 0,
         "part_label": "b", "group_key": "p0:1", "group_label": "1", "group_stem": SETUP},
        {"kind": "frq", "question_text": "Define rank.", "expected_answer": "x"},
    ])
    mcq, frq = _reviewed_questions_from_form(raw)
    assert [q.seq for q in frq] == [0, 2] and mcq[0].seq == 1
    assert mcq[0].group_key == "p0:1" and mcq[0].part_label == "b"
    assert frq[1].group_key is None and frq[1].part_label is None


async def _seed_test(session) -> tuple[User, TestModel]:
    user = User(email="parts@example.com", google_id="g-parts", is_beta=True)
    session.add(user)
    await session.flush()
    folder = Folder(user_id=user.id, name="Linear Algebra")
    session.add(folder)
    await session.flush()
    test = TestModel(folder_id=folder.id, title="HW 3", test_type="mixed", is_math_mode=True)
    session.add(test)
    await session.flush()
    return user, test


async def test_parts_are_saved_together_with_one_setup(db_session_maker) -> None:
    async with db_session_maker() as session:
        _, test = await _seed_test(session)
        mcq, frq = LLMService()._practice_group_entry(_picker_entry(), 0, "1")
        frq = [*frq, GeneratedFRQ("Define rank.", "x", seq=10)]
        next_order = await add_generated_questions(Repo(session), test.id, mcq, frq, 1)
        await session.commit()
        assert next_order == 5

        questions = list(await session.scalars(select(Question).order_by(Question.display_order)))
        assert [(q.question_type, q.part_label) for q in questions] == [
            ("FRQ", "a"), ("MCQ", "b"), ("FRQ", "c"), ("FRQ", None),
        ]
        groups = list(await session.scalars(select(QuestionGroup)))
        assert len(groups) == 1 and groups[0].stem == SETUP and groups[0].label == "1"
        assert {q.group_id for q in questions[:3]} == {groups[0].id}
        assert questions[3].group_id is None


async def test_grading_a_part_sends_the_setup_and_results_carry_the_group(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, test = await _seed_test(session)
        _, frq = LLMService()._practice_group_entry(_picker_entry(), 0, "1")
        await add_generated_questions(Repo(session), test.id, [], frq, 1)
        await session.commit()
        part_a = await session.scalar(select(Question).where(Question.part_label == "a"))

        service = GradingService(llm_service=AsyncMock())
        service.llm_service.grade_math_answer = AsyncMock(
            return_value=FRQGrade(is_correct=True, feedback="ok", confidence=0.9)
        )
        result = await service.submit_and_grade(
            test.id, user.id, [SubmittedAnswer(question_id=part_a.id, answer="-2")], session
        )
        sent = service.llm_service.grade_math_answer.await_args.kwargs["question"]
        assert sent.startswith(SETUP) and sent.endswith("(a) Find $\\det A$.")
        answer = result.answers[0]
        assert answer.group_stem == SETUP and answer.part_label == "a" and answer.group_label == "1"
        assert answer.question_text == "Find $\\det A$."


async def test_the_setup_is_edited_once_for_every_part(db_session_maker) -> None:
    async with db_session_maker() as session:
        user, test = await _seed_test(session)
        _, frq = LLMService()._practice_group_entry(_picker_entry(), 0, "1")
        await add_generated_questions(Repo(session), test.id, [], frq, 1)
        await session.commit()
        group = await session.scalar(select(QuestionGroup))

        updated = await Service().update_question_group(
            test.id, group.id, user.id, QuestionGroupUpdate(stem="Let $A = I$."), session
        )
        assert updated.stem == "Let $A = I$."
        part = await Repo(session).get_question_owned(
            (await session.scalar(select(Question.id).where(Question.part_label == "a"))), user.id
        )
        assert full_question_text(part).startswith("Let $A = I$.")


# ── Picked problems are matched by id, never by the document's number ───


async def test_reply_is_matched_by_problem_id_not_document_number() -> None:
    from src.services.llm_service import _match_practice_entries

    reply = [{"problem": "P2", "frq": []}, {"problem": "P1", "frq": []}]
    assert {slot: e["problem"] for slot, e in _match_practice_entries(reply, 2).items()} == {0: "P1", 1: "P2"}
    # A partly matched reply is never filled in by order (that shifts problems).
    assert list(_match_practice_entries([{"problem": "P1"}, {"problem": 99}], 3)) == [0]
    # No usable id at all, but one entry per problem: taken in order.
    assert list(_match_practice_entries([{"problem": 35}, {"problem": 36}], 2)) == [0, 1]


async def test_a_reply_using_document_numbers_is_not_dropped(monkeypatch) -> None:
    """The model answered "problem": "P1" for document problem 35 (index 34)."""
    llm = LLMService()

    async def fake_json(prompt, provider=None):
        assert "=== P1 (numbered 35 in the document) ===" in prompt
        return {"problems": [{"problem": "P1", "setup": SETUP, "frq": [
            {"n": 1, "part": "a", "question_text": "Find det.", "expected_answer": "-2"},
        ]}]}

    monkeypatch.setattr(llm, "_complete_json", fake_json)
    out = await llm.parse_practice_problems([(34, "35", "35. ... (a) Find det.")])
    assert out[34] is not None and out[34][1][0].group_key == "p34:35"
