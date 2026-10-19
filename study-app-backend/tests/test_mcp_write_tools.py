"""MCP write tools, end to end over /mcp (OAuth flow from test_mcp_connector)."""
from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from src.models.flashcard import Flashcard
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.mcq_option import MCQOption
from src.models.question import Question
from src.models.test import Test as TestRow
from src.services import mcp_tools, mcp_write_tools
from src.services.test_service import TestService as TestSvc  # noqa: N814
from tests.test_mcp_connector import _connect, _rpc, client, seeded  # noqa: F401  (fixtures)

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def call(client):  # noqa: F811
    access = (await _connect(client))["access_token"]

    async def _call(name: str, arguments: dict, expect_error: bool = False) -> dict:
        result = (await _rpc(client, access, "tools/call", {"name": name, "arguments": arguments})).json()["result"]
        assert result["isError"] is expect_error, result
        return json.loads(result["content"][0]["text"])

    _call.access = access  # type: ignore[attr-defined]
    return _call


def _frq(text: str, answer: str = "x", **kw) -> dict:
    return {"type": "FRQ", "text": text, "expected_answer": answer, "topic": "Basics", **kw}


def _mcq(text: str) -> dict:
    return {"type": "MCQ", "text": text, "options": [{"text": "a", "correct": True}, {"text": "b"}], "topic": "Basics"}


async def test_folders_can_be_created_and_renamed_never_deleted(client, call, db_session_maker) -> None:  # noqa: F811
    tools = (await _rpc(client, call.access, "tools/list")).json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert {"create_folder", "rename_folder"} <= names
    assert "delete_folder" not in names
    assert next(t for t in tools if t["name"] == "delete_test")["annotations"]["destructiveHint"] is True

    made = await call("create_folder", {"name": "Organic Chem"})
    renamed = await call("rename_folder", {"folder_id": made["folder_id"], "name": "Orgo"})
    assert renamed["name"] == "Orgo"
    async with db_session_maker() as session:
        folder = await session.get(Folder, made["folder_id"])
        assert folder.created_via == "mcp"


async def test_create_test_any_order_multipart_and_custom_inputs(call, seeded, db_session_maker) -> None:  # noqa: F811
    groups = [
        {
            "type": "GROUP",
            "label": f"Problem {n}",
            "setup": f"A ball is thrown at {n} m/s.",
            "parts": [_mcq("Which way is gravity?"), _frq("Find the max height", input="math")],
        }
        for n in range(1, 6)
    ]
    items = groups + [_frq("Explain drag in words", input="text"), _frq("Write simulate()", input="code", code_language="Python")]
    made = await call("create_test", {"folder_id": seeded["folder_id"], "title": "Kinematics", "items": items})

    assert made["question_count"] == 12 and made["custom_mode"] is True
    assert made["url"].endswith(f"/test/{made['test_id']}")
    assert len(made["items"]) == 7 and len(made["items"][0]["question_ids"]) == 2

    async with db_session_maker() as session:
        test = await session.get(TestRow, made["test_id"])
        assert test.created_via == "mcp" and test.test_type == "mixed"
        rows = (await session.scalars(
            select(Question).where(Question.test_id == test.id).order_by(Question.display_order)
        )).all()
        assert [q.part_label for q in rows[:2]] == ["a", "b"]
        assert [q.answer_input for q in rows[-2:]] == ["text", "code"]
        assert rows[1].answer_input == "math" and rows[0].answer_input is None  # MCQ keeps no input
        take = await TestSvc().get_test_for_taking(test.id, seeded["beta"].id, session)
        assert take.is_custom_mode
        assert [q.question_text for q in take.questions][-1] == "Write simulate()"


async def test_invalid_questions_come_back_as_fixable_errors(call, seeded) -> None:  # noqa: F811
    two_correct = {"type": "MCQ", "text": "Pick", "options": [{"text": "a", "correct": True}, {"text": "b", "correct": True}], "topic": "Basics"}
    err = await call("create_test", {"folder_id": seeded["folder_id"], "title": "Bad", "items": [two_correct]}, expect_error=True)
    assert "exactly one correct" in err["error"]

    err = await call(
        "create_test",
        {"folder_id": seeded["folder_id"], "title": "Bad", "items": [{"type": "TF", "text": "Sky is blue", "input": "math", "correct_answer": True, "topic": "Basics"}]},
        expect_error=True,
    )
    assert "only for FRQ" in err["error"]

    err = await call("create_test", {"folder_id": seeded["foreign_id"], "title": "x", "items": [_frq("q")]}, expect_error=True)
    assert "not found" in err["error"]


async def test_add_and_edit_questions(call, seeded, db_session_maker) -> None:  # noqa: F811
    made = await call("create_test", {"folder_id": seeded["folder_id"], "title": "T", "items": [_frq("Q1")]})
    added = await call("add_questions", {"test_id": made["test_id"], "items": [{"type": "TF", "text": "2 > 1", "correct_answer": True, "topic": "Basics"}]})
    assert added["question_count"] == 2
    tf_id = added["items"][0]["question_id"]
    frq_id = made["items"][0]["question_id"]

    await call("edit_question", {"question_id": frq_id, "input": "code", "code_language": "Go"})
    await call("edit_question", {"question_id": tf_id, "correct_answer": False})
    await call("edit_question", {"question_id": frq_id, "input": None})
    err = await call("edit_question", {"question_id": frq_id, "options": [{"text": "a", "correct": True}, {"text": "b"}]}, expect_error=True)
    assert "only be edited on MCQ and MS" in err["error"]

    async with db_session_maker() as session:
        frq = await session.get(Question, frq_id)
        assert (frq.answer_input, frq.code_language) == (None, None)
        options = (await session.scalars(
            select(MCQOption).where(MCQOption.question_id == tf_id).order_by(MCQOption.display_order)
        )).all()
        assert [(o.option_text, o.is_correct) for o in options] == [("True", False), ("False", True)]


async def test_deletes_need_confirm(call, seeded, db_session_maker) -> None:  # noqa: F811
    made = await call("create_test", {"folder_id": seeded["folder_id"], "title": "Doomed", "items": [_frq("Q")]})
    err = await call("delete_test", {"test_id": made["test_id"], "confirm": False}, expect_error=True)
    assert "Nothing was deleted" in err["error"]
    async with db_session_maker() as session:
        assert await session.get(TestRow, made["test_id"]) is not None
    await call("delete_test", {"test_id": made["test_id"], "confirm": True})
    async with db_session_maker() as session:
        assert await session.get(TestRow, made["test_id"]) is None


async def test_flashcards_crud_scoped_to_owner(call, seeded, db_session_maker) -> None:  # noqa: F811
    async with db_session_maker() as session:
        foreign_card = Flashcard(folder_id=seeded["foreign_id"], front="theirs", back="theirs")
        session.add(foreign_card)
        await session.commit()
        foreign_id = foreign_card.id

    made = await call("create_flashcards", {"folder_id": seeded["folder_id"], "cards": [{"front": "H", "back": "Hydrogen", "topic": "Elements"}, {"front": "He", "back": "Helium", "topic": "Elements"}]})
    first, second = made["flashcard_ids"]
    await call("edit_flashcard", {"flashcard_id": first, "back": "Hydrogen (1)"})
    err = await call("edit_flashcard", {"flashcard_id": foreign_id, "back": "pwned"}, expect_error=True)
    assert "not found" in err["error"]
    deleted = await call("delete_flashcards", {"flashcard_ids": [second, foreign_id], "confirm": True})
    assert deleted == {"deleted": [second], "not_found": [foreign_id]}

    async with db_session_maker() as session:
        card = await session.get(Flashcard, first)
        assert card.back == "Hydrogen (1)" and card.source == "mcp"
        assert await session.get(Flashcard, foreign_id) is not None


async def test_notes_add_duplicate_and_delete(call, seeded, db_session_maker) -> None:  # noqa: F811
    note = await call("add_note", {"folder_id": seeded["folder_id"], "content": "# Cells\nMitochondria make ATP."})
    assert note["file_name"] == "# Cells"
    dup = await call("add_note", {"folder_id": seeded["folder_id"], "content": "# Cells\nMitochondria make ATP."}, expect_error=True)
    assert "already exists" in dup["error"]
    await call("delete_note", {"note_id": note["note_id"], "confirm": True})
    async with db_session_maker() as session:
        assert await session.get(FolderFile, note["note_id"]) is None


async def test_write_rate_limit_per_user(call, seeded, monkeypatch) -> None:  # noqa: F811
    from limits import parse

    monkeypatch.setattr(mcp_tools, "_WRITE_LIMITS", (parse("2/minute"),))
    for n in range(2):
        await call("create_folder", {"name": f"F{n}"})
    err = await call("create_folder", {"name": "F2"}, expect_error=True)
    assert "Too many changes" in err["error"]
    # Reads are never limited by the write cap.
    await call("list_folders", {})


async def test_moderation_refusal_is_a_tool_error_and_saves_nothing(call, seeded, db_session_maker, monkeypatch) -> None:  # noqa: F811
    async def refuse(*args, **kwargs):
        raise HTTPException(status_code=400, detail="This content isn't allowed in Nosey.")

    monkeypatch.setattr(mcp_write_tools, "screen_user_input", refuse)
    err = await call("create_folder", {"name": "Bad"}, expect_error=True)
    assert err["error"] == "This content isn't allowed in Nosey."
    async with db_session_maker() as session:
        names = (await session.scalars(select(Folder.name))).all()
        assert "Bad" not in names


async def test_regrade_attempt_overwrites_grades_and_rescores(call, seeded, db_session_maker) -> None:  # noqa: F811
    from src.models.user_answer import UserAnswer
    from src.models.user_attempt import UserAttempt
    from src.services.grading_service import GradingService

    made = await call("create_test", {"folder_id": seeded["folder_id"], "title": "Rubric",
                                      "items": [_frq("Define entropy"), _frq("Define enthalpy")]})
    qids = [item.get("question_id") or item["question_ids"][0] for item in made["items"]]
    async with db_session_maker() as session:
        attempt = UserAttempt(user_id=seeded["beta"].id, test_id=made["test_id"], attempt_number=1,
                              status="submitted", total_questions=2, correct_count=0, total_score=0)
        session.add(attempt)
        await session.flush()
        for qid in qids:
            session.add(UserAnswer(attempt_id=attempt.id, question_id=qid, user_answer="?",
                                   is_correct=False, ai_feedback="Nosey says no"))
        await session.commit()
        attempt_id = attempt.id

    out = await call("regrade_attempt", {"attempt_id": attempt_id, "grades": [
        {"question_id": qids[0], "is_correct": True, "feedback": "Meets my rubric"}]})
    assert out == {"attempt_id": attempt_id, "score": 50.0, "correct_count": 1, "total": 2, "regraded": 1}

    async with db_session_maker() as session:
        detail = await GradingService().get_attempt_detail(attempt_id, seeded["beta"].id, session)
        by_q = {a.question_id: a for a in detail.answers}
        assert by_q[qids[0]].feedback == "Meets my rubric" and by_q[qids[0]].graded_by == "agent"
        assert by_q[qids[1]].graded_by is None and detail.score == 50.0

    await call("regrade_attempt", {"attempt_id": attempt_id, "grades": [
        {"question_id": 999999, "is_correct": True, "feedback": "x"}]}, expect_error=True)
    await call("regrade_attempt", {"attempt_id": attempt_id, "grades": [
        {"question_id": qids[0], "is_correct": True, "feedback": "x"},
        {"question_id": qids[0], "is_correct": False, "feedback": "y"}]}, expect_error=True)
