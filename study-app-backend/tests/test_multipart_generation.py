"""Multi-part problems beyond recreated practice tests.

1. "Match its style" keeps a multi-part original multi-part: its parts are
   written together against one new setup.
2. Beta multi-part problems for notes-based tests: an isolated call writes
   part of the written count as problems, and a shortfall is topped up with
   ordinary written questions so the count holds.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from src.models.folder import Folder
from src.models.question import Question
from src.models.question_group import QuestionGroup
from src.models.test import Test as TestRow
from src.models.user import User
from src.routes.tests import _multipart_share
from src.services.llm_service import GeneratedFRQ, GeneratedMCQ, LLMService

pytestmark = pytest.mark.asyncio


def _problem(setup: str, n: int) -> dict:
    return {"setup": setup, "parts": [{"question_text": f"part {i}", "expected_answer": f"ans {i}"} for i in range(n)]}


async def test_parser_groups_parts_and_caps_the_total() -> None:
    data = {"problems": [_problem("Setup one", 3), _problem("Setup two", 3)]}
    parts = LLMService._parse_multipart_problems(data, 5)
    assert [p.part_label for p in parts] == ["a", "b", "c", "a", "b"]
    assert {p.group_key for p in parts} == {"mp:1", "mp:2"}
    assert parts[3].group_stem == "Setup two"
    assert [p.seq for p in parts] == [0, 1, 2, 3, 4]


async def test_parser_drops_problems_without_a_setup_or_two_parts() -> None:
    data = {"problems": [
        {"setup": "", "parts": _problem("x", 2)["parts"]},
        _problem("Lonely", 1),
        _problem("Good", 2),
        "junk",
    ]}
    parts = LLMService._parse_multipart_problems(data, 6)
    assert [p.group_stem for p in parts] == ["Good", "Good"]
    assert parts[0].group_label == "1"
    # A leftover of one part cannot form a problem.
    assert LLMService._parse_multipart_problems({"problems": [_problem("A", 2), _problem("B", 2)]}, 3) == \
        LLMService._parse_multipart_problems({"problems": [_problem("A", 2)]}, 3)


async def test_share_of_written_questions() -> None:
    assert _multipart_share(0) == 0
    assert _multipart_share(1) == 0
    assert _multipart_share(3) == 3
    assert _multipart_share(5) == 3
    assert _multipart_share(10) == 5


async def test_style_prompt_carries_setups_only_for_grouped_originals() -> None:
    svc = LLMService()
    part = GeneratedFRQ("Find its inverse", "x", part_label="b", group_key="p:3", group_label="3", group_stem="Let f(x)=2x")
    plain = GeneratedFRQ("Define a vector", "x")
    grouped = svc._parallel_prompt([("frq", part)], "", "mixed", None)
    assert "PROBLEM SETUPS" in grouped and "Let f(x)=2x" in grouped
    assert "part (b) of problem 3" in grouped and '"setups"' in grouped
    flat = svc._parallel_prompt([("frq", plain)], "", "mixed", None)
    assert "PROBLEM SETUPS" not in flat and '"setups"' not in flat


async def test_style_mode_keeps_a_problem_together_with_its_new_setup() -> None:
    svc = LLMService()
    originals_mcq = [GeneratedMCQ("Pick one", ["1", "2"], 0, part_label="b", group_key="p:1", group_label="1",
                                  group_stem="Old setup", seq=2)]
    originals_frq = [
        GeneratedFRQ("Lone question", "a", seq=0),
        GeneratedFRQ("Part a text", "a", part_label="a", group_key="p:1", group_label="1", group_stem="Old setup", seq=1),
    ]
    svc.parse_practice_test = AsyncMock(return_value=(originals_mcq, originals_frq))
    reply = {
        "setups": [{"problem": "1", "setup": "New setup"}],
        "questions": [
            {"original": 1, "question_text": "New lone", "expected_answer": "x"},
            {"original": 2, "question_text": "New part a", "expected_answer": "y"},
            {"original": 3, "question_text": "New pick", "options": ["3", "4"], "correct_index": 1},
        ],
    }
    svc._complete_json = AsyncMock(return_value=reply)
    svc._solve_keyless_questions = AsyncMock(side_effect=lambda m, f, n: (m, f))

    mcq, frq = await svc.generate_parallel_practice_test("doc")

    # One batch, in document order: the lone question, then the problem's parts.
    prompt = svc._complete_json.call_args.args[0]
    assert prompt.index("Lone question") < prompt.index("Part a text") < prompt.index("Pick one")
    by_text = {q.question_text: q for q in mcq + frq}
    assert by_text["New lone"].group_key is None
    assert by_text["New part a"].part_label == "a" and by_text["New part a"].group_stem == "New setup"
    assert by_text["New pick"].part_label == "b" and by_text["New pick"].group_key == "p:1"
    assert [by_text[t].seq for t in ("New lone", "New part a", "New pick")] == [0, 1, 2]


async def _seed(session_maker) -> int:
    async with session_maker() as session:
        user = User(email="mp@example.com", google_id="g-mp")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="F")
        session.add(folder)
        await session.flush()
        test = TestRow(folder_id=folder.id, title="T", test_type="FRQ_only")
        session.add(test)
        await session.commit()
        return test.id


def _llm(problems: list[GeneratedFRQ]) -> MagicMock:
    async def generate(**kwargs):
        return [], [GeneratedFRQ(f"plain {i}", "a") for i in range(kwargs.get("count_frq", 0))]

    llm = MagicMock()
    llm.generate_test_questions = AsyncMock(side_effect=generate)
    llm.generate_multipart_problems = AsyncMock(return_value=problems)
    llm.generate_extra_question_types = AsyncMock(return_value=([], [], []))
    return llm


async def _run(session_maker, llm, test_id: int, multi_part: bool, is_coding_mode: bool = False) -> None:
    from src.routes.tests import _generate_questions_background

    with (
        patch("src.routes.tests.async_session_maker", session_maker),
        patch("src.routes.tests.LLMService", return_value=llm),
        patch("src.routes.tests._verify_persisted_mcqs", new=AsyncMock()),
    ):
        await _generate_questions_background(
            test_id=test_id, user_id=1, notes_content="notes", practice_test_content="",
            test_type="FRQ_only", count_mcq=0, count_frq=5, is_math_mode=True, difficulty="mixed",
            topic_focus=None, is_coding_mode=is_coding_mode, coding_language=None,
            custom_instructions=None, provider=None, enable_fallback=True, multi_part=multi_part,
        )


async def _questions(session_maker, test_id: int) -> list[Question]:
    async with session_maker() as session:
        rows = await session.scalars(select(Question).where(Question.test_id == test_id).order_by(Question.display_order))
        return list(rows.all())


async def test_multi_part_takes_a_share_of_the_written_count(db_session_maker) -> None:
    test_id = await _seed(db_session_maker)
    problems = LLMService._parse_multipart_problems({"problems": [_problem("Setup", 3)]}, 3)
    llm = _llm(problems)
    await _run(db_session_maker, llm, test_id, multi_part=True)

    assert llm.generate_test_questions.call_args_list[0].kwargs["count_frq"] == 2
    assert llm.generate_multipart_problems.call_args.kwargs["part_count"] == 3
    assert llm.generate_multipart_problems.call_args.kwargs["is_math_mode"] is True
    questions = await _questions(db_session_maker, test_id)
    assert len(questions) == 5
    assert [q.part_label for q in questions] == [None, None, "a", "b", "c"]
    async with db_session_maker() as session:
        groups = (await session.scalars(select(QuestionGroup))).all()
    assert [g.stem for g in groups] == ["Setup"]


async def test_a_short_multi_part_reply_is_topped_up(db_session_maker) -> None:
    test_id = await _seed(db_session_maker)
    llm = _llm([])  # the isolated call failed or returned nothing
    await _run(db_session_maker, llm, test_id, multi_part=True)

    counts = [c.kwargs["count_frq"] for c in llm.generate_test_questions.call_args_list]
    assert counts == [2, 3]
    assert len(await _questions(db_session_maker, test_id)) == 5


async def test_off_or_coding_mode_never_calls_multi_part(db_session_maker) -> None:
    for kwargs in ({"multi_part": False}, {"multi_part": True, "is_coding_mode": True}):
        test_id = await _seed_unique(db_session_maker)
        llm = _llm([])
        await _run(db_session_maker, llm, test_id, **kwargs)
        llm.generate_multipart_problems.assert_not_awaited()
        assert llm.generate_test_questions.call_args_list[0].kwargs["count_frq"] == 5


_n = 0


async def _seed_unique(session_maker) -> int:
    global _n
    _n += 1
    async with session_maker() as session:
        user = User(email=f"mp{_n}@example.com", google_id=f"g-mp{_n}")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="F")
        session.add(folder)
        await session.flush()
        test = TestRow(folder_id=folder.id, title="T", test_type="FRQ_only")
        session.add(test)
        await session.commit()
        return test.id
