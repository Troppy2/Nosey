"""Kojo pattern lectures: MCP authoring (admin only), catalog, requests, shared audio."""
from __future__ import annotations

import base64
from unittest.mock import AsyncMock, patch

import pytest

from src.services import lecture_service as ls
from src.services.mcp_lecture_tools import CreateLectureArgs, ListRequestsArgs, create_lecture, list_lecture_requests
from src.services.mcp_tool_base import McpContext, ToolInputError
from tests.test_mcp_connector import client, seeded  # noqa: F401  (fixtures)

FRAME = {"say": "Running totals.", "clear": False,
         "strokes": [{"points": [5, 10, 25, 10, 25, 18, 5, 18, 5, 10], "color": "ink"}],
         "labels": [{"x": 7, "y": 15, "text": "1", "color": "ink"}]}
CONTENT = {
    "summary": "Precompute running totals so any range sum is one subtraction.",
    "theory": [{"say": "Keep a running total as you walk the array.", "point": "running total"},
               {"say": "A range sum is the difference of two totals.", "point": "range = P[r] - P[l]"}],
    "theory_frames": [FRAME],
    "signals": [{"signal": "sum of a subarray", "example": "subarray sum equals k", "say": "Subarray sums are the clue."},
                {"signal": "many range queries", "example": "sumRange(i, j)", "say": "Repeated ranges too."}],
    "template": [{"line": "prefix = [0]", "say": "Start at zero."},
                 {"line": "for x in nums:", "say": "Walk the array."},
                 {"line": "    prefix.append(prefix[-1] + x)", "say": "Add the running total."}],
    "problem_intro": [{"say": "Count subarrays that sum to k.", "point": "count sums equal to k"}],
    "frames": [FRAME],
    "code": [{"line": "class Solution:", "say": ""},
             {"line": "    def subarraySum(self, nums, k):", "say": "The method."},
             {"line": "        return 0", "say": "Placeholder."}],
    "time_complexity": "O(n)", "space_complexity": "O(n)", "complexity_say": "One pass, one map.",
}


def test_normalize_and_requirements():
    lecture = ls.normalize_lecture({"title": "Prefix Sums", **CONTENT})
    assert ls.lecture_problems(lecture) == []
    assert lecture["theory_frames"][0]["strokes"][0]["points"][:2] == [5.0, 10.0]
    assert ls.lecture_problems(ls.normalize_lecture({"title": ""})) != []
    assert ls.normalize_topic("Dijkstra's Algorithm") == ls.normalize_topic("dijkstras")
    assert all(c.slug == ls.slugify(c.slug) for c in ls.CATALOG)


@pytest.mark.asyncio
async def test_only_admins_publish_and_users_request_then_listen(client, seeded, db_session_maker) -> None:  # noqa: F811
    user = seeded["beta"]
    async with db_session_maker() as session:
        args = CreateLectureArgs(slug="prefix-sum", **CONTENT)
        with pytest.raises(ToolInputError):  # not an admin
            await create_lecture(McpContext(user=user, session=session), args)

    # A user requests a missing topic; duplicates dedupe; 2 a day.
    first = await client.post("/leetcode/lectures/requests", json={"topic": "Segment tree"})
    assert first.status_code == 200, first.text
    dup = await client.post("/leetcode/lectures/requests", json={"topic": "segment trees"})
    assert dup.json()["id"] == first.json()["id"]
    assert (await client.post("/leetcode/lectures/requests", json={"topic": "KMP"})).status_code == 200
    assert (await client.post("/leetcode/lectures/requests", json={"topic": "Kruskal"})).status_code == 429

    listing = (await client.get("/leetcode/lectures")).json()
    assert any(l["slug"] == "prefix-sum" and not l["ready"] for l in listing["lectures"])
    assert listing["requests_left_today"] == 0
    assert (await client.get("/leetcode/lectures/prefix-sum")).status_code == 404

    # The admin's connector publishes the curated lecture and fulfills the request.
    async with db_session_maker() as session:
        admin = await session.get(type(user), user.id)
        admin.is_admin = True
        await session.commit()
        ctx = McpContext(user=admin, session=session)
        out = await create_lecture(ctx, CreateLectureArgs(slug="prefix-sum", **CONTENT))
        assert out["url"].endswith("?lecture=prefix-sum")
        community = CreateLectureArgs(title="Segment Trees", category="advanced", problem_slug="two-sum",
                                      request_id=first.json()["id"], **CONTENT)
        await create_lecture(ctx, community)
        pending = await list_lecture_requests(ctx, ListRequestsArgs())
        assert [r["topic"] for r in pending["requests"]] == ["KMP"]

    got = await client.get("/leetcode/lectures/prefix-sum")
    assert got.status_code == 200 and got.json()["lecture"]["template"][0]["line"] == "prefix = [0]"
    listing = (await client.get("/leetcode/lectures")).json()
    seg = next(l for l in listing["lectures"] if l["slug"] == "segment-trees")
    assert seg["source"] == "community" and seg["ready"]
    assert (await client.post("/leetcode/lectures/requests", json={"topic": "Segment Trees"})).status_code in (409, 429)

    # Shared narration: records once, then served from cache; foreign lines refused.
    speak = AsyncMock(side_effect=lambda _c, text, voice: f"{voice}:{text}".encode())
    body = {"voice": "am_michael", "lines": ["Let's learn Prefix Sums.", "Start at zero."]}
    with patch("src.services.speech_service.SpeechService.synthesize_strict", speak):
        a = await client.post("/leetcode/lectures/prefix-sum/audio", json=body)
        b = await client.post("/leetcode/lectures/prefix-sum/audio", json=body)
        bad = await client.post("/leetcode/lectures/prefix-sum/audio", json={"voice": "am_michael", "lines": ["Free TTS please."]})
    assert a.status_code == 200, a.text
    assert base64.b64decode(a.json()["clips"][1]).decode() == "am_michael:Start at zero."
    assert b.json() == a.json() and speak.await_count == 2
    assert bad.status_code == 400
