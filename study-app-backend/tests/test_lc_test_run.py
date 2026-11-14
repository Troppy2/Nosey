"""KojoCode run log: interview realism skips Kojo's grade, so the run log records the
failed-run struggle signal that /leetcode/grade would have written."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.lc_sync import LCStruggleEvent, LCTestRun
from tests.test_mcp_connector import client, seeded  # noqa: F401  (fixtures)

RUN = {"problem_slug": "two-sum", "topic": "arrays", "subtopic": "Hash Map", "difficulty": "Easy"}


async def _events(db_session_maker) -> list[LCStruggleEvent]:
    async with db_session_maker() as session:
        return list((await session.execute(select(LCStruggleEvent))).scalars().all())


@pytest.mark.asyncio
async def test_failed_run_without_grade_logs_struggle_signal(client, db_session_maker) -> None:  # noqa: F811
    # Normal mode: /grade logs the failure, so the run log alone adds no event.
    assert (await client.post("/leetcode/test-run", json={**RUN, "passed": False})).status_code == 204
    assert await _events(db_session_maker) == []

    # Realism: a passing run is never a struggle; a failing one is.
    ok = await client.post("/leetcode/test-run", json={**RUN, "passed": True, "grade_skipped": True})
    assert ok.status_code == 204
    assert await _events(db_session_maker) == []
    failed = await client.post("/leetcode/test-run", json={**RUN, "passed": False, "grade_skipped": True})
    assert failed.status_code == 204

    events = await _events(db_session_maker)
    assert [(e.event_type, e.topic, e.subtopic, e.problem_slug) for e in events] == [
        ("failed_grade", "arrays", "Hash Map", "two-sum")
    ]
    async with db_session_maker() as session:
        runs = (await session.execute(select(LCTestRun))).scalars().all()
    assert len(runs) == 3
