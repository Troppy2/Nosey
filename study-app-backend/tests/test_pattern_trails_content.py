"""Pattern Trails content writer, the Sliding window seed and the MCP tools."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.pattern_trail import PTGateItem, PTStep, PTSubtopic, PTTopic
from src.models.user import User
from src.services import lc_catalog
from src.services.mcp_tool_base import McpContext, ToolInputError
from src.services.mcp_trail_tools import AddTrailArgs, ListTrailsArgs, add_trail_content, list_trails
from src.services.pattern_trails import content, rules
from src.services.pattern_trails.seed_sliding_window import SLIDING_WINDOW, topic

pytestmark = pytest.mark.asyncio


async def _steps(session, sub_slug):
    sub = (await session.execute(select(PTSubtopic).where(PTSubtopic.slug == sub_slug))).scalar_one()
    rows = (await session.execute(select(PTStep).where(PTStep.subtopic_id == sub.id).order_by(PTStep.position))).scalars().all()
    return [(r.position, r.problem_slug) for r in rows]


def _small(*slugs: str) -> content.TopicIn:
    return content.TopicIn.model_validate(
        {
            "slug": "demo",
            "title": "Demo",
            "subtopics": [{"slug": "demo-path", "title": "Demo path", "steps": [{"problem_slug": s} for s in slugs]}],
        }
    )


async def test_seed_data_is_well_formed():
    data = topic()
    assert [s.slug for s in data.subtopics] == [
        "fixed-window", "shortest-valid-window", "counting-subarrays", "longest-valid-window",
    ]
    assert all(len(s.steps) == rules.STEPS_PER_PATH for s in data.subtopics)
    own = {s.slug for s in data.subtopics}
    for item in data.gate_items:
        assert bool(item.right_subtopic_slug) != bool(item.right_pattern_key)
        if item.right_subtopic_slug:
            assert item.right_subtopic_slug in own
    # Enough own items to draw a gate of 5 with at least 3 from the topic.
    assert sum(1 for i in data.gate_items if i.right_subtopic_slug) >= 3
    assert len(data.gate_items) >= 5


async def test_seed_only_writes_problems_that_exist(db_session_maker):
    async with db_session_maker() as session:
        report = await content.upsert_topic(session, topic())
    known_steps = {
        f"{sub['slug']}:{step['problem_slug']}"
        for sub in SLIDING_WINDOW["subtopics"]
        for step in sub["steps"]
        if lc_catalog.get(step["problem_slug"]) is not None
    }
    async with db_session_maker() as session:
        rows = (await session.execute(select(PTStep, PTSubtopic).join(PTSubtopic, PTStep.subtopic_id == PTSubtopic.id))).all()
        written = {f"{sub.slug}:{step.problem_slug}" for step, sub in rows}
    assert written == known_steps
    # Whatever was skipped is exactly what the catalog does not have.
    for label in report.skipped_steps:
        assert lc_catalog.get(label.split(":", 1)[1]) is None
    assert len(written) + len(report.skipped_steps) == 20


async def test_upsert_is_idempotent_and_keeps_positions_compact(db_session_maker):
    async with db_session_maker() as session:
        await content.upsert_topic(session, _small("two-sum", "valid-anagram", "group-anagrams"))
    async with db_session_maker() as session:
        first = await _steps(session, "demo-path")
        report = await content.upsert_topic(session, _small("two-sum", "valid-anagram", "group-anagrams"))
        assert await _steps(session, "demo-path") == first
        assert not report.created or all(not c.startswith(("subtopic", "topic")) for c in report.created)
    # Reorder and drop one: positions stay 1..n with no unique-constraint clash.
    async with db_session_maker() as session:
        await content.upsert_topic(session, _small("group-anagrams", "two-sum"))
        assert await _steps(session, "demo-path") == [(1, "group-anagrams"), (2, "two-sum")]


async def test_unknown_problem_is_skipped_and_reported(db_session_maker):
    async with db_session_maker() as session:
        report = await content.upsert_topic(session, _small("two-sum", "no-such-problem-xyz"))
        assert report.skipped_steps == ["demo-path:no-such-problem-xyz"]
        assert await _steps(session, "demo-path") == [(1, "two-sum")]
    async with db_session_maker() as session:
        empty = await content.upsert_topic(session, _small("no-such-problem-xyz"))
        assert empty.skipped_subtopics == ["demo-path"]


async def test_gate_item_needs_a_right_answer(db_session_maker):
    bad = content.TopicIn.model_validate(
        {
            "slug": "demo2", "title": "Demo 2",
            "subtopics": [{"slug": "demo2-path", "title": "P", "steps": [{"problem_slug": "two-sum"}]}],
            "gate_items": [{"problem_slug": "valid-anagram", "cue": "x"}],
        }
    )
    async with db_session_maker() as session:
        with pytest.raises(Exception, match="right_subtopic_slug"):
            await content.upsert_topic(session, bad)


async def test_subtopic_slug_cannot_move_between_topics(db_session_maker):
    other = content.TopicIn.model_validate(
        {"slug": "other", "title": "Other", "subtopics": [{"slug": "demo-path", "title": "P", "steps": [{"problem_slug": "two-sum"}]}]}
    )
    async with db_session_maker() as session:
        await content.upsert_topic(session, _small("two-sum"))
    async with db_session_maker() as session:
        with pytest.raises(Exception, match="already belongs"):
            await content.upsert_topic(session, other)


async def test_mcp_tools_are_beta_only_and_work(db_session_maker):
    async with db_session_maker() as session:
        beta = User(email="b@example.com", google_id="g-b", is_beta=True, is_admin=False)
        basic = User(email="c@example.com", google_id="g-c", is_beta=False, is_admin=False)
        session.add_all([beta, basic])
        await session.commit()
        args = AddTrailArgs(topic=_small("two-sum", "valid-anagram"))
        with pytest.raises(ToolInputError):
            await add_trail_content(McpContext(user=basic, session=session), args)
        out = await add_trail_content(McpContext(user=beta, session=session), args)
        assert "subtopic:demo-path" in out["created"]
        listed = await list_trails(McpContext(user=beta, session=session), ListTrailsArgs())
        demo = next(t for t in listed["topics"] if t["slug"] == "demo")
        assert [s["problem_slug"] for s in demo["subtopics"][0]["steps"]] == ["two-sum", "valid-anagram"]
        with pytest.raises(ToolInputError):
            await list_trails(McpContext(user=basic, session=session), ListTrailsArgs())


async def test_tools_are_registered():
    from src.services.mcp_tools import TOOLS
    assert {"add_trail_content", "list_trails"} <= set(TOOLS)
    assert TOOLS["list_trails"].read_only is True
    assert TOOLS["add_trail_content"].read_only is False
