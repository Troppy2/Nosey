"""Pattern Trails routes end to end on SQLite (spec section 10, backend routes)."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.main import app
from src.models.lc_sync import LCActivityDate, LCProgress
from src.models.pattern_trail import PTGateItem, PTRedo, PTStep, PTSubtopic, PTTopic
from src.models.user import User
from src.routes import pattern_trails as pt_routes
from src.schemas.leetcode_schema import LeetCodeExample, LeetCodeProblemResponse, LeetCodeTopicTag

pytestmark = pytest.mark.asyncio

SW = "sliding-window"


@pytest_asyncio.fixture
async def seeded(db_session_maker):
    async with db_session_maker() as session:
        beta = User(email="beta@example.com", google_id="g-beta", is_beta=True, is_admin=False)
        basic = User(email="basic@example.com", google_id="g-basic", is_beta=False, is_admin=False)
        session.add_all([beta, basic])
        topic = PTTopic(slug=SW, title="Sliding window", sort_order=0)
        session.add(topic)
        await session.flush()
        fixed = PTSubtopic(topic_id=topic.id, slug="fixed-window", title="Fixed window", sort_order=0,
                           lecture_slug="fixed-window", cues_json=json.dumps(["window of size k"]))
        shortest = PTSubtopic(topic_id=topic.id, slug="shortest-window", title="Shortest valid window", sort_order=1)
        session.add_all([fixed, shortest])
        await session.flush()
        for sub, prefix in ((fixed, "fw"), (shortest, "sw")):
            for position in range(1, 6):
                session.add(PTStep(subtopic_id=sub.id, position=position, problem_slug=f"{prefix}-{position}",
                                   difficulty="Medium"))
        for index in range(4):
            session.add(PTGateItem(topic_id=topic.id, problem_slug=f"gate-own-{index}", difficulty="Medium",
                                   right_subtopic_id=(fixed if index % 2 == 0 else shortest).id,
                                   cue=f"own cue {index}"))
        for index in range(2):
            session.add(PTGateItem(topic_id=topic.id, problem_slug=f"gate-other-{index}", difficulty="Easy",
                                   right_pattern_key="prefix-sum", right_pattern_title="Prefix sum",
                                   cue=f"other cue {index}"))
        await session.commit()
        return {"beta": beta, "basic": basic}


class _Slot:
    def __init__(self) -> None:
        self.released = 0

    def release(self) -> None:
        self.released += 1


@pytest_asyncio.fixture
async def client(db_session_maker, seeded, monkeypatch):
    state = {"user": seeded["beta"]}
    slots: list[_Slot] = []
    notes: dict[str, object] = {"value": "Kojo says the window size gave it away.", "prompts": []}

    async def _session():
        async with db_session_maker() as session:
            yield session

    async def _user():
        return state["user"]

    async def _gate(session, user, feature):
        assert feature == "kojo_trail_reason"
        slot = _Slot()
        slots.append(slot)
        return slot

    async def _note(prompt):
        notes["prompts"].append(prompt)  # type: ignore[union-attr]
        return notes["value"]

    async def _screen(*args, **kwargs):
        return None

    monkeypatch.setattr(pt_routes, "_kojo_gate", _gate)
    monkeypatch.setattr(pt_routes, "write_reason_note", _note)
    monkeypatch.setattr(pt_routes, "screen_user_input", _screen)
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user] = _user
    limiter.reset()
    try:
        async with AsyncClient(app=app, base_url="http://test") as http:
            http.state = state  # type: ignore[attr-defined]
            http.slots = slots  # type: ignore[attr-defined]
            http.notes = notes  # type: ignore[attr-defined]
            yield http
    finally:
        app.dependency_overrides.clear()


async def _steps(client, slug: str) -> list[dict]:
    res = await client.get(f"/pattern-trails/subtopics/{slug}")
    assert res.status_code == 200, res.text
    return res.json()["steps"]


async def _pass(client, step_id: int, seconds: int = 600, **extra) -> dict:
    body = {"pass_number": 3, "accepted": True, "seconds": seconds, "tz_offset_minutes": 0, **extra}
    res = await client.post(f"/pattern-trails/steps/{step_id}/result", json=body)
    assert res.status_code == 200, res.text
    return res.json()


async def _finish(client, slug: str) -> dict:
    assert (await client.post(f"/pattern-trails/subtopics/{slug}/lesson-watched")).status_code == 200
    out: dict = {}
    for step in await _steps(client, slug):
        out = await _pass(client, step["id"])
    return out


# ── Access ────────────────────────────────────────────────────────────────────


async def test_non_beta_gets_403(client, seeded) -> None:
    client.state["user"] = seeded["basic"]
    assert (await client.get("/pattern-trails")).status_code == 403
    assert (await client.post("/pattern-trails/gates/sliding-window/start")).status_code == 403


# ── Map, lessons, steps ───────────────────────────────────────────────────────


async def test_map_starts_with_first_path_open_and_gate_locked(client) -> None:
    data = (await client.get("/pattern-trails")).json()
    land = data["topics"][0]
    assert [s["open"] for s in land["subtopics"]] == [True, False]
    assert land["subtopics"][0]["step_states"] == ["locked"] * 5
    assert land["gate"]["state"] == "locked"
    assert data["solved_total"] == 0
    assert data["current_topic_slug"] == SW


async def test_lesson_gates_step_one(client) -> None:
    steps = await _steps(client, "fixed-window")
    assert steps[0]["locked_reason"] == "Watch the lesson first"
    res = await client.post(f"/pattern-trails/steps/{steps[0]['id']}/result",
                            json={"pass_number": 3, "accepted": True, "seconds": 10})
    assert res.status_code == 409
    assert res.json()["detail"] == "Watch the lesson first"

    path = (await client.post("/pattern-trails/subtopics/fixed-window/lesson-watched")).json()
    assert path["lesson"]["watched"] is True
    assert [s["state"] for s in path["steps"]] == ["open", "locked", "locked", "locked", "locked"]
    assert path["steps"][1]["locked_reason"] == "Pass step 1 first"


async def test_locked_subtopic_lesson_is_refused(client) -> None:
    path = (await client.get("/pattern-trails/subtopics/shortest-window")).json()
    assert path["open"] is False and path["locked_reason"] == "Finish Fixed window first"
    assert (await client.post("/pattern-trails/subtopics/shortest-window/lesson-watched")).status_code == 409


async def test_pass_walks_and_counts_solved(client, db_session_maker, seeded) -> None:
    await client.post("/pattern-trails/subtopics/fixed-window/lesson-watched")
    steps = await _steps(client, "fixed-window")
    out = await _pass(client, steps[0]["id"])
    assert (out["passed"], out["slow"], out["solved_delta"], out["walked_to"], out["redo"]) == (True, False, 1, 1, None)
    assert [s["state"] for s in out["path"]["steps"]][:2] == ["passed", "open"]

    async with db_session_maker() as session:
        row = (await session.execute(select(LCProgress).where(LCProgress.problem_slug == "fw-1"))).scalar_one()
        assert row.done is True and row.solved_at is not None
        day = (await session.execute(select(LCActivityDate))).scalar_one()
        assert day.count == 1

    # Passing it again: no second walk, no second +1.
    again = await _pass(client, steps[0]["id"])
    assert again["solved_delta"] == 0 and again["walked_to"] is None


async def test_already_solved_problem_still_counts_globally(client, db_session_maker, seeded) -> None:
    old = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with db_session_maker() as session:
        session.add(LCProgress(user_id=seeded["beta"].id, problem_slug="fw-1", done=True, solved_at=old))
        await session.commit()
    await client.post("/pattern-trails/subtopics/fixed-window/lesson-watched")
    steps = await _steps(client, "fixed-window")
    assert (await _pass(client, steps[0]["id"]))["solved_delta"] == 1
    async with db_session_maker() as session:
        row = (await session.execute(select(LCProgress).where(LCProgress.problem_slug == "fw-1"))).scalar_one()
        assert row.solved_at.replace(tzinfo=timezone.utc) == old  # first-solve stamp kept
        assert (await session.execute(select(LCActivityDate))).scalar_one().count == 1


async def test_fail_stays_put_and_schedules_redo(client) -> None:
    await client.post("/pattern-trails/subtopics/fixed-window/lesson-watched")
    steps = await _steps(client, "fixed-window")
    out = await _pass(client, steps[0]["id"], accepted=False)
    assert out["passed"] is False and out["solved_delta"] == 0
    assert out["path"]["steps"][0]["state"] == "open"
    redo = out["redo"]
    assert redo["interval_index"] == 0 and redo["due"] is False and redo["last_result"] == "failed"
    assert out["path"]["steps"][0]["redo"]["id"] == redo["id"]

    # Over the time limit (Medium = 1500s) is a fail too, and replaces the live redo.
    over = await _pass(client, steps[0]["id"], seconds=1501)
    assert over["passed"] is False and over["redo"]["id"] == redo["id"]
    redos = (await client.get("/pattern-trails/redos")).json()
    assert len(redos["waiting"]) == 1 and redos["due"] == []


async def test_slow_pass_passes_and_schedules_redo(client) -> None:
    await client.post("/pattern-trails/subtopics/fixed-window/lesson-watched")
    steps = await _steps(client, "fixed-window")
    out = await _pass(client, steps[0]["id"], seconds=1300)  # > 80% of 1500
    assert out["passed"] and out["slow"] and out["solved_delta"] == 1
    assert out["redo"]["last_result"] == "slow"


async def test_practice_passes_change_nothing(client) -> None:
    await client.post("/pattern-trails/subtopics/fixed-window/lesson-watched")
    steps = await _steps(client, "fixed-window")
    out = await _pass(client, steps[0]["id"], pass_number=2)
    assert out["passed"] is False and out["redo"] is None
    assert out["path"]["steps"][0]["attempts"] == 0


async def test_finishing_paths_opens_next_then_gate(client) -> None:
    first = await _finish(client, "fixed-window")
    assert first["path_finished"] and first["next_subtopic_opened"] == "shortest-window"
    assert first["gate_opened"] is False
    second = await _finish(client, "shortest-window")
    assert second["gate_opened"] is True and second["next_subtopic_opened"] is None
    data = (await client.get("/pattern-trails")).json()
    assert data["topics"][0]["gate"]["state"] == "open"
    assert data["solved_total"] == 10


# ── Redos ─────────────────────────────────────────────────────────────────────


async def test_redo_not_due_then_advance_and_reset(client, db_session_maker) -> None:
    await client.post("/pattern-trails/subtopics/fixed-window/lesson-watched")
    steps = await _steps(client, "fixed-window")
    redo_id = (await _pass(client, steps[0]["id"], accepted=False))["redo"]["id"]
    assert (await client.post(f"/pattern-trails/redos/{redo_id}/result",
                              json={"accepted": True, "seconds": 100})).status_code == 409

    async def make_due() -> None:
        async with db_session_maker() as session:
            row = await session.get(PTRedo, redo_id)
            row.due_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            await session.commit()

    await make_due()
    res = (await client.post(f"/pattern-trails/redos/{redo_id}/result", json={"accepted": True, "seconds": 100})).json()
    assert res["passed"] and res["redo"]["interval_index"] == 1
    await make_due()
    res = (await client.post(f"/pattern-trails/redos/{redo_id}/result", json={"accepted": False, "seconds": 100})).json()
    assert not res["passed"] and res["redo"]["interval_index"] == 0
    for _ in range(3):
        await make_due()
        res = (await client.post(f"/pattern-trails/redos/{redo_id}/result",
                                 json={"accepted": True, "seconds": 100})).json()
    assert res["retired"] is True and res["redo"] is None
    assert (await client.get("/pattern-trails/redos")).json() == {"due": [], "waiting": []}


# ── Gate ──────────────────────────────────────────────────────────────────────


async def _right_keys(db_session_maker) -> dict[int, str]:
    async with db_session_maker() as session:
        items = (await session.execute(select(PTGateItem))).scalars().all()
        subs = {sub.id: sub.slug for sub in (await session.execute(select(PTSubtopic))).scalars().all()}
    return {item.id: subs.get(item.right_subtopic_id) or item.right_pattern_key for item in items}


def _wrong_key(right: str) -> str:
    return "fixed-window" if right != "fixed-window" else "shortest-window"


async def test_gate_needs_every_path(client) -> None:
    res = await client.post(f"/pattern-trails/gates/{SW}/start")
    assert res.status_code == 409


async def test_gate_draw_hides_problems_and_resumes(client) -> None:
    await _finish(client, "fixed-window")
    await _finish(client, "shortest-window")
    res = await client.post(f"/pattern-trails/gates/{SW}/start")
    assert res.status_code == 200, res.text
    attempt = res.json()
    assert len(attempt["items"]) == 5
    assert "gate-" not in res.text  # no problem slug anywhere
    assert {o["key"] for o in attempt["options"]} == {"fixed-window", "shortest-window", "prefix-sum"}
    assert all(item["right_pattern"] is None and item["cue"] is None for item in attempt["items"])
    again = (await client.post(f"/pattern-trails/gates/{SW}/start")).json()
    assert again["attempt_id"] == attempt["attempt_id"]
    assert [i["id"] for i in again["items"]] == [i["id"] for i in attempt["items"]]


async def test_pick_verdict_is_the_servers_and_slot_is_released(client, db_session_maker) -> None:
    await _finish(client, "fixed-window")
    await _finish(client, "shortest-window")
    attempt = (await client.post(f"/pattern-trails/gates/{SW}/start")).json()
    rights = await _right_keys(db_session_maker)
    item = attempt["items"][0]
    right = rights[item["id"]]
    # The "model" insists the pick is wrong; the verdict must not care.
    client.notes["value"] = "That is wrong."
    res = await client.post(f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/pick",
                            json={"item_id": item["id"], "picked_key": right, "reason": "window of size k"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["correct"] is True and body["right_pattern"]["key"] == right
    assert body["kojo_note"] == "That is wrong."
    assert "Their pick is RIGHT" in client.notes["prompts"][-1]
    assert [slot.released for slot in client.slots] == [1]

    # Same item twice: refused. Unknown pattern: refused.
    dup = await client.post(f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/pick",
                            json={"item_id": item["id"], "picked_key": right, "reason": "again"})
    assert dup.status_code == 409
    bad = await client.post(f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/pick",
                            json={"item_id": attempt["items"][1]["id"], "picked_key": "made-up", "reason": "x"})
    assert bad.status_code == 409


async def test_llm_failure_still_returns_the_cue(client, db_session_maker) -> None:
    await _finish(client, "fixed-window")
    await _finish(client, "shortest-window")
    attempt = (await client.post(f"/pattern-trails/gates/{SW}/start")).json()
    rights = await _right_keys(db_session_maker)
    item = attempt["items"][0]
    client.notes["value"] = None  # write_reason_note returns None on any provider failure
    body = (await client.post(f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/pick",
                              json={"item_id": item["id"], "picked_key": _wrong_key(rights[item["id"]]),
                                    "reason": "no idea"})).json()
    assert body["correct"] is False and body["kojo_note"] is None
    assert body["cue"].endswith(("cue 0", "cue 1", "cue 2", "cue 3"))
    assert client.slots[-1].released == 1


async def test_kojo_limit_skips_the_note_not_the_pick(client, db_session_maker, monkeypatch) -> None:
    from fastapi import HTTPException

    async def _limited(session, user, feature):
        raise HTTPException(status_code=429, detail="limit")

    monkeypatch.setattr(pt_routes, "_kojo_gate", _limited)
    await _finish(client, "fixed-window")
    await _finish(client, "shortest-window")
    attempt = (await client.post(f"/pattern-trails/gates/{SW}/start")).json()
    rights = await _right_keys(db_session_maker)
    item = attempt["items"][0]
    res = await client.post(f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/pick",
                            json={"item_id": item["id"], "picked_key": rights[item["id"]], "reason": "k window"})
    assert res.status_code == 200 and res.json()["kojo_note"] is None


async def _play(client, db_session_maker, right_count: int) -> dict:
    attempt = (await client.post(f"/pattern-trails/gates/{SW}/start")).json()
    rights = await _right_keys(db_session_maker)
    last: dict = {}
    for index, item in enumerate(attempt["items"]):
        right = rights[item["id"]]
        key = right if index < right_count else _wrong_key(right)
        last = (await client.post(f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/pick",
                                  json={"item_id": item["id"], "picked_key": key, "reason": "because"})).json()
    return last["attempt"]


async def test_gate_three_of_five_locks_for_a_day(client, db_session_maker) -> None:
    await _finish(client, "fixed-window")
    await _finish(client, "shortest-window")
    result = await _play(client, db_session_maker, 3)
    assert result["correct_count"] == 3 and result["passed"] is False and result["locked_until"]
    assert (await client.post(f"/pattern-trails/gates/{SW}/start")).status_code == 409
    gate = (await client.get("/pattern-trails")).json()["topics"][0]["gate"]
    assert gate["state"] == "cooldown" and gate["cleared"] is False


async def test_gate_four_of_five_clears(client, db_session_maker) -> None:
    await _finish(client, "fixed-window")
    await _finish(client, "shortest-window")
    result = await _play(client, db_session_maker, 4)
    assert result["passed"] is True and result["locked_until"] is None
    data = (await client.get("/pattern-trails")).json()
    assert data["topics"][0]["gate"]["cleared"] is True
    stats = {s["slug"]: s["stats"] for s in data["topics"][0]["subtopics"]}
    assert sum(s["picks"] for s in stats.values()) >= 3  # own-topic picks feed recognition


async def test_gate_solve_needs_a_pick_and_never_blocks(client, db_session_maker) -> None:
    await _finish(client, "fixed-window")
    await _finish(client, "shortest-window")
    attempt = (await client.post(f"/pattern-trails/gates/{SW}/start")).json()
    item = attempt["items"][0]
    url = f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/solve"
    assert (await client.post(url, json={"item_id": item["id"], "accepted": True, "seconds": 60})).status_code == 409
    rights = await _right_keys(db_session_maker)
    await client.post(f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/pick",
                      json={"item_id": item["id"], "picked_key": rights[item["id"]], "reason": "k"})
    out = (await client.post(url, json={"item_id": item["id"], "accepted": False, "seconds": 60})).json()
    assert out["solved"] is False and out["redo"]["gate_item_id"] == item["id"]


async def test_gate_problem_has_no_title_slug_or_tags(client, monkeypatch) -> None:
    await _finish(client, "fixed-window")
    await _finish(client, "shortest-window")
    attempt = (await client.post(f"/pattern-trails/gates/{SW}/start")).json()

    async def _problem(self, slug):
        return LeetCodeProblemResponse(
            title="Sliding Window Maximum", title_slug=slug, difficulty="Hard", content_html="<p>Given nums...</p>",
            examples=[LeetCodeExample(index=1, input_text="nums = [1]", output_text="[1]")],
            example_testcases=["[1]"], python_snippet="class Solution: ...",
            topic_tags=[LeetCodeTopicTag(name="Sliding Window", slug="sliding-window")],
        )

    monkeypatch.setattr(pt_routes.LeetCodeService, "get_problem", _problem)
    item_id = attempt["items"][0]["id"]
    res = await client.get(f"/pattern-trails/gates/attempts/{attempt['attempt_id']}/items/{item_id}/problem")
    assert res.status_code == 200, res.text
    assert "Sliding Window Maximum" not in res.text and "gate-" not in res.text
    assert "topic_tags" not in res.json() and "title" not in res.json()
    # Another user's attempt is not reachable.
    assert (await client.get(f"/pattern-trails/gates/attempts/999/items/{item_id}/problem")).status_code == 404
