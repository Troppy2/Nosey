"""MCP learning module tools, end to end over /mcp."""
from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from src.models.learning_module import LearningModule, LearningTrack
from src.services.llm_service import LLMService
from tests.test_mcp_connector import _connect, _rpc, client, seeded  # noqa: F401  (fixtures)

pytestmark = pytest.mark.asyncio

LESSON = "# Cells\n\nCells are the unit of life.\n\n$$E = mc^2$$"  # 3 paragraphs


def _quiz(n: int = 3) -> list[dict]:
    return [
        {"question": f"Q{i}", "options": ["right", "wrong"], "correct_index": 0, "explanation": "Because."}
        for i in range(n)
    ]


def _module(title: str, **kw) -> dict:
    return {"title": title, "lesson_markdown": LESSON, "quiz": _quiz(), **kw}


@pytest.fixture
async def call(client):  # noqa: F811
    access = (await _connect(client))["access_token"]

    async def _call(name: str, arguments: dict, expect_error: bool = False) -> dict:
        result = (await _rpc(client, access, "tools/call", {"name": name, "arguments": arguments})).json()["result"]
        assert result["isError"] is expect_error, result
        return json.loads(result["content"][0]["text"])

    return _call


async def test_track_works_with_nosey_reader_and_quiz_gate(client, call, seeded, db_session_maker, monkeypatch) -> None:  # noqa: F811
    async def no_llm(*args, **kwargs):
        raise AssertionError("Nosey's LLM must not be called for a Claude-written quiz")

    monkeypatch.setattr(LLMService, "generate_quiz_explanations", no_llm)
    made = await call(
        "create_learning_track",
        {
            "folder_id": seeded["folder_id"],
            "modules": [
                _module("Cells", narration=["Cells.", "Cells are the unit of life.", "Energy equals m c squared."]),
                _module("Atoms", video_url="https://youtu.be/abc"),
            ],
        },
    )
    first = made["modules"][0]["module_id"]

    track = (await client.get(f"/folders/{seeded['folder_id']}/learning-track")).json()
    assert track["status"] == "ready" and track["notes_stale"] is False
    assert track["unlocked"] is True  # MCP-built: no pass-to-unlock gate
    assert [m["title"] for m in track["modules"]] == ["Cells", "Atoms"]
    assert json.loads(track["modules"][0]["tts_script"])[2] == "Energy equals m c squared."
    assert track["modules"][1]["tts_script"] is None  # reader falls back to the lesson text

    graded = (await client.post(f"/learning-modules/{first}/quiz-attempt", json={"answers": [0, 0, 1]})).json()
    assert graded["score"] == 2 and graded["passed"] is False  # 2/3 < 80%
    graded = (await client.post(f"/learning-modules/{first}/quiz-attempt", json={"answers": [0, 0, 0]})).json()
    assert graded["passed"] is True

    async with db_session_maker() as session:
        row = await session.get(LearningTrack, made["track_id"])
        assert row.created_via == "mcp"


async def test_new_track_archives_the_active_one(call, seeded, db_session_maker) -> None:  # noqa: F811
    old = await call("create_learning_track", {"folder_id": seeded["folder_id"], "modules": [_module("v1")]})
    new = await call("create_learning_track", {"folder_id": seeded["folder_id"], "modules": [_module("v2")]})
    assert new["archived_track_ids"] == [old["track_id"]]
    async with db_session_maker() as session:
        assert (await session.get(LearningTrack, old["track_id"])).is_archived is True
        assert (await session.get(LearningTrack, new["track_id"])).is_archived is False
    # Restoring the old one while v2 is active is refused, not silently swapped.
    err = await call("archive_track", {"track_id": old["track_id"], "archived": False}, expect_error=True)
    assert "already has an active" in err["error"]


async def test_validation_errors_are_fixable(call, seeded) -> None:  # noqa: F811
    bad_narration = _module("x", narration=["only one"])
    err = await call("create_learning_track", {"folder_id": seeded["folder_id"], "modules": [bad_narration]}, expect_error=True)
    assert "the lesson has 3, got 1" in err["error"]

    no_explanation = _module("x", quiz=[{"question": "Q", "options": ["a", "b"], "correct_index": 0}] * 3)
    err = await call("create_learning_track", {"folder_id": seeded["folder_id"], "modules": [no_explanation]}, expect_error=True)
    assert "explanation" in err["error"]

    short_quiz = _module("x", quiz=_quiz(2))
    err = await call("create_learning_track", {"folder_id": seeded["folder_id"], "modules": [short_quiz]}, expect_error=True)
    assert "quiz" in err["error"]


async def test_add_edit_delete(call, seeded, db_session_maker) -> None:  # noqa: F811
    made = await call(
        "create_learning_track",
        {"folder_id": seeded["folder_id"], "modules": [_module("One", narration=["a", "b", "c"])]},
    )
    added = await call("add_modules", {"track_id": made["track_id"], "modules": [_module("Two")]})
    module_id = made["modules"][0]["module_id"]
    assert added["modules"][0]["order_index"] == 1

    # A new lesson without new narration drops the stale script.
    await call("edit_module", {"module_id": module_id, "lesson_markdown": "Just one paragraph now."})
    async with db_session_maker() as session:
        module = await session.get(LearningModule, module_id)
        assert module.lesson_content == "Just one paragraph now." and module.tts_script is None

    err = await call("delete_track", {"track_id": made["track_id"], "confirm": False}, expect_error=True)
    assert "Nothing was deleted" in err["error"]
    await call("delete_track", {"track_id": made["track_id"], "confirm": True})
    async with db_session_maker() as session:
        assert await session.get(LearningTrack, made["track_id"]) is None
        left = (await session.scalars(select(LearningModule).where(LearningModule.track_id == made["track_id"]))).all()
        assert left == []
