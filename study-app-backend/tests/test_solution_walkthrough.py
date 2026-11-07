"""KojoCode solution walkthrough: normalization and the cached route."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.services import solution_walkthrough as sw
from tests.test_mcp_connector import client, seeded  # noqa: F401  (fixtures)

SCRIPT = {
    "title": "Hash map",
    "breakdown": ["We get nums and a target.", "Return two indexes."],
    "key_points": ["Find a pair"],
    "approaches": [
        {"name": "Brute force", "time": "O(n^2)", "space": "O(1)", "verdict": "too slow", "idea": "Try pairs.", "why": "Slow.", "say": "x"},
        {"name": "Hash map", "time": "O(n)", "space": "O(n)", "verdict": "OPTIMAL", "idea": "Store seen.", "why": "One pass.", "say": "y"},
    ],
    "code": [
        {"line": "", "say": ""},
        {"line": "class Solution:", "say": ""},
        {"line": "    def twoSum(self, nums, target):", "say": "Method."},
        {"line": "        return []", "say": "Done."},
    ],
    "time_complexity": "O(n)", "space_complexity": "O(n)", "complexity_say": "One pass.",
}
SKETCH = {"frames": [
    {"say": "Array.", "strokes": [{"points": [0, 0, 500, 10, 20], "color": "purple"}, {"points": [1]}],
     "labels": [{"x": 5, "y": 5, "text": "2"}, {"x": "bad", "y": 1, "text": "z"}]},
    {"say": "empty", "strokes": [], "labels": []},
]}


def test_normalize_script_and_sketch():
    script = sw.normalize_script(SCRIPT)
    assert script["code"][0]["line"] == "class Solution:"
    assert script["approaches"][1]["verdict"] == "optimal" and sw.is_usable(script)
    frames = sw.normalize_sketch(SKETCH)
    assert len(frames) == 1
    stroke = frames[0]["strokes"][0]
    assert stroke["points"] == [0.0, 0.0, 100.0, 10.0] and stroke["color"] == "ink"
    assert [label["text"] for label in frames[0]["labels"]] == ["2"]


@pytest.mark.asyncio
async def test_walkthrough_route_builds_once_then_caches(client) -> None:  # noqa: F811
    script = AsyncMock(return_value=SCRIPT)
    sketch = AsyncMock(side_effect=RuntimeError("sketch down"))
    body = {"title": "Two Sum", "statement": "Find two numbers that add to target."}
    with patch("src.services.llm_service.LLMService.generate_walkthrough_script", script), \
         patch("src.services.llm_service.LLMService.generate_walkthrough_sketch", sketch):
        first = await client.post("/leetcode/walkthrough/two-sum", json=body)
        assert first.status_code == 200, first.text
        assert first.json()["walkthrough"]["frames"] == []  # failed sketch keeps the rest
        assert first.json()["solution_code"].startswith("class Solution:")
        again = await client.post("/leetcode/walkthrough/two-sum", json=body)
        assert again.json() == first.json()
    assert script.await_count == 1
    assert (await client.post("/leetcode/walkthrough/two-sum!", json=body)).status_code in (400, 404)
    assert (await client.post("/leetcode/walkthrough/other", json={})).status_code == 400


@pytest.mark.asyncio
async def test_audio_records_every_line_in_one_voice_then_caches(client) -> None:  # noqa: F811
    speak = AsyncMock(side_effect=lambda _client, text, voice: f"{voice}:{text}".encode())
    body = {"voice": "am_michael", "lines": ["Let's solve Two Sum.", "Store what we have seen."]}
    with patch("src.services.speech_service.SpeechService.synthesize_strict", speak):
        first = await client.post("/leetcode/walkthrough/two-sum/audio", json=body)
        assert first.status_code == 200, first.text
        again = await client.post("/leetcode/walkthrough/two-sum/audio", json=body)
    import base64
    clips = [base64.b64decode(c).decode() for c in first.json()["clips"]]
    assert clips == ["am_michael:Let's solve Two Sum.", "am_michael:Store what we have seen."]
    assert again.json() == first.json() and speak.await_count == 2  # second call served from cache

    fail = AsyncMock(side_effect=__import__("src.utils.exceptions", fromlist=["LLMException"]).LLMException("down"))
    with patch("src.services.speech_service.SpeechService.synthesize_strict", fail):
        res = await client.post("/leetcode/walkthrough/two-sum/audio", json={"voice": "af_bella", "lines": ["Hi."]})
    assert res.status_code == 503
    bad = await client.post("/leetcode/walkthrough/two-sum/audio", json={"voice": "evil", "lines": ["Hi."]})
    assert bad.status_code == 422


def _frame(labels, strokes=(), clear=False):
    return {"say": "s", "clear": clear, "strokes": [{"points": list(p), "color": "ink"} for p in strokes],
            "labels": [{"x": x, "y": y, "text": t} for x, y, t in labels]}


def test_rewriting_a_spot_erases_the_old_label_and_clashes_nudge():
    frames = sw.normalize_sketch({"frames": [
        _frame([(60, 15, "count=1"), (60, 30, "start")]),
        _frame([(60, 15, "count=2")]),            # same spot: erases count=1
        _frame([(61, 31, "visit (1,3)")]),        # overlaps "start" lower down: rewrite too
    ]})
    first = frames[0]["labels"]
    assert first[0]["until"] == 1 and first[1]["until"] == 2
    assert "until" not in frames[1]["labels"][0]
    assert not any(f["clear"] for f in frames)


def test_tiny_scribble_becomes_a_circle_and_arrow_heads_stay():
    frames = sw.normalize_sketch({"frames": [_frame([], [(14, 14, 16, 14, 16, 16, 14, 16, 14, 14), (22, 14, 20, 12)])]})
    circle, head = frames[0]["strokes"]
    xs = circle["points"][0::2]
    assert len(xs) == 13 and max(xs) - min(xs) > 6
    assert head["points"] == [22.0, 14.0, 20.0, 12.0]


def test_relayout_is_idempotent():
    walk = {"frames": [_frame([(60, 15, "a")]), _frame([(60, 15, "b")])]}
    once = sw.relayout(walk)
    import copy
    twice = sw.relayout(copy.deepcopy(once))
    assert once == twice
