"""Kojo tools (GH #205): reply parsing, confirm tokens, and the tool loop with a fake LLM."""
from __future__ import annotations

import time

import pytest

from src.services import kojo_service as ks
from src.services import kojo_tools as kt


def _filter(chunks: list[str]) -> tuple[str, kt.ToolTagFilter]:
    f = kt.ToolTagFilter()
    out = "".join(f.feed(c) for c in chunks) + f.flush()
    return out, f


def test_filter_leading_tool_never_streams():
    out, f = _filter(["  <to", 'ol>{"name":"list_folders","args":{}}</tool>', " after"])
    assert out == ""
    assert f.leading and f.calls == ['{"name":"list_folders","args":{}}']
    assert f.trailing.strip() == "after"


def test_filter_strips_trailing_button_from_answer():
    out, f = _filter(["Hello a<", 'tool>{"name":"open_action"}</tool>'])
    assert out == "Hello a"
    assert not f.leading and len(f.calls) == 1


def test_filter_plain_text_with_angle_brackets():
    out, _ = _filter(["x < y and <b>bold</b>"])
    assert out == "x < y and <b>bold</b>"


def test_parse_call_tolerates_extra_brace_and_rejects_unknown():
    assert kt.parse_call('{"name":"read_note","args":{"note_id":3}}}').args == {"note_id": 3}
    assert kt.parse_call('{"name":"drop_db","args":{}}').error
    assert kt.parse_call("not json").error


def test_token_round_trip_and_tamper():
    token = kt.sign_action(5, 9, "delete_test", {"test_id": 1, "confirm": True})
    assert kt.verify_action(token, 5)["a"] == {"test_id": 1, "confirm": True}
    assert kt.verify_action(token, 6) is None
    assert kt.verify_action(token[:-3] + "abc", 5) is None


def test_token_expires(monkeypatch):
    token = kt.sign_action(5, 9, "delete_test", {"test_id": 1})
    monkeypatch.setattr(time, "time", lambda: 10**12)
    assert kt.verify_action(token, 5) is None


def test_destructive_args_get_confirm():
    args, err = kt.validate_args("delete_test", {"test_id": 2})
    assert err is None and args["confirm"] is True


def test_action_link_needs_ids():
    assert kt.action_link({"kind": "review_due", "folder_id": 3, "label": "Review"})["to"] == "/flashcards/3/review?due=1"
    assert kt.action_link({"kind": "review_due", "label": "Review"}) is None


class _FakeLLM:
    def __init__(self, replies):
        self.replies = list(replies)
        self.last_kojo_provider = None
        self.providers, self.prompts = [], []

    async def stream_kojo(self, prompt, provider=None):
        self.providers.append(provider)
        self.prompts.append(prompt)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        self.last_kojo_provider = provider or "groq"
        for i in range(0, len(reply), 5):
            yield reply[i:i + 5]


class _NullSession:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def patched(monkeypatch):
    async def fake_run(user, name, args):
        return {"folders": [{"id": 1, "name": "Bio"}]}, False

    async def fake_describe(ctx, name, args):
        return 'Delete test "Mid"?', []

    import src.database as db

    monkeypatch.setattr(kt, "run_isolated", fake_run)
    monkeypatch.setattr(kt, "describe", fake_describe)
    monkeypatch.setattr(db, "async_session_maker", lambda: _NullSession())


async def _run(replies, reasoning=False):
    llm = _FakeLLM(replies)
    chunks: list[str] = []
    user = type("U", (), {"id": 5})()
    events = [e async for e in ks._stream_tool_turn(llm, "BASE\nRespond now:", None, reasoning, True, False, chunks, {}, user, 9)]
    return events, "".join(chunks).strip(), llm


async def test_plain_answer_streams(patched):
    events, answer, _ = await _run(["Osmosis is water moving."])
    assert answer == "Osmosis is water moving."
    assert all(e["type"] == "delta" for e in events)


async def test_read_then_answer_pins_provider(patched):
    events, answer, llm = await _run([
        '<tool>{"name":"list_folders","args":{}}</tool>',
        'You have Bio. <tool>{"name":"open_action","args":{"kind":"open_folder","folder_id":1,"label":"Open"}}</tool>',
    ])
    assert answer == "You have Bio."
    assert llm.providers == [None, "groq"]
    assert "TOOL RESULTS" in llm.prompts[1]
    assert [e for e in events if e["type"] == "actions"][0]["buttons"][0]["to"] == "/folders/1"


async def test_delete_becomes_card_not_run(patched):
    events, answer, _ = await _run(['<tool>{"name":"delete_test","args":{"test_id":3}}</tool> Deleting it.'])
    card = [e for e in events if e["type"] == "card"][0]["card"]
    assert card["danger"] and answer == "Deleting it."
    assert kt.verify_action(card["token"], 5)["n"] == "delete_test"


async def test_later_round_failure_answers_with_results(patched):
    _, answer, llm = await _run(['<tool>{"name":"list_folders","args":{}}</tool>', RuntimeError("boom"), "Fallback."])
    assert answer == "Fallback."
    assert llm.providers[-1] is None  # fallback chain back on
    assert "Tools are not available" in llm.prompts[-1]


async def test_round_cap(patched):
    _, answer, llm = await _run(['<tool>{"name":"list_folders","args":{}}</tool>'] * kt.MAX_ROUNDS)
    assert len(llm.prompts) == kt.MAX_ROUNDS
    assert answer


def test_stray_tag_is_cut_and_recovered():
    text, calls = kt.strip_stray_tags('Go review. <open_action>{"kind": "dashboard", "label": "Home"}</open_action>')
    assert text == "Go review."
    assert calls[0].name == "open_action"
    kept, none = kt.strip_stray_tags("Use <b>{x}</b> here")
    assert kept == "Use <b>{x}</b> here" and none == []


async def test_narrated_tool_call_still_runs(patched):
    events, answer, llm = await _run([
        'Let me pull your data. <tool>{"name":"list_folders","args":{}}</tool>',
        "You have Bio.",
    ])
    assert len(llm.prompts) == 2 and "TOOL RESULTS" in llm.prompts[1]
    assert answer.startswith("Let me pull your data.") and answer.endswith("You have Bio.")
    assert any(e["type"] == "tool" for e in events)
