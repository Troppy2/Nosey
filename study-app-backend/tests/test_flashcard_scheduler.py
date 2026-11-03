from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.services.flashcard_scheduler import CardScheduleState, schedule

FIXTURE = Path(__file__).parent / "fixtures" / "schedule_parity.json"


def test_schedule_parity_fixture():
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert len(rows) > 0
    for row in rows:
        init = row["initial"]
        now = datetime.fromisoformat(row["now"].replace("Z", "+00:00"))
        state = CardScheduleState(
            ease=init.get("ease", 2.5),
            interval_days=init.get("interval_days", 0),
            reps=init.get("reps", 0),
            lapses=init.get("lapses", 0),
        )
        res = schedule(state, row["rating"], now)
        exp = row["expected"]

        assert res.ease == pytest.approx(exp["ease"], abs=1e-4)
        assert res.interval_days == exp["interval_days"]
        assert res.reps == exp["reps"]
        assert res.lapses == exp["lapses"]
        assert res.difficulty == exp["difficulty"]

        exp_due = datetime.fromisoformat(exp["due_at"].replace("Z", "+00:00"))
        assert res.due_at == exp_due
        exp_reviewed = datetime.fromisoformat(exp["last_reviewed_at"].replace("Z", "+00:00"))
        assert res.last_reviewed_at == exp_reviewed


def test_schedule_hard_requeue_time():
    now = datetime(2026, 11, 2, 10, 0, 0, tzinfo=timezone.utc)
    card = CardScheduleState(ease=2.5, interval_days=5, reps=3, lapses=0)
    res = schedule(card, "hard", now)
    assert res.interval_days == 0
    assert res.reps == 0
    assert res.lapses == 1
    assert (res.due_at - now).total_seconds() == 600  # 10 minutes


def test_schedule_invalid_rating():
    now = datetime(2026, 11, 2, 10, 0, 0, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        schedule(CardScheduleState(), "invalid", now)
