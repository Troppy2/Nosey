from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal, Optional

Rating = Literal["hard", "medium", "easy"]


@dataclass
class CardScheduleState:
    ease: float = 2.5
    interval_days: int = 0
    reps: int = 0
    lapses: int = 0
    due_at: Optional[datetime] = None
    last_reviewed_at: Optional[datetime] = None
    difficulty: int = 1


def _round_half_up(val: float) -> int:
    return int(math.floor(val + 0.5))


def _field(card_state: Any, name: str, default: float) -> float:
    """Read a schedule field from an ORM row, dataclass or dict; None means default."""
    if isinstance(card_state, dict):
        value = card_state.get(name, default)
    else:
        value = getattr(card_state, name, None)
    return default if value is None else value


def schedule(card_state: Any, rating: str, now: datetime) -> CardScheduleState:
    rating_lower = rating.lower()
    if rating_lower not in ("hard", "medium", "easy"):
        raise ValueError(f"Invalid rating: {rating}. Must be 'hard', 'medium', or 'easy'.")

    ease = float(_field(card_state, "ease", 2.5))
    interval = int(_field(card_state, "interval_days", 0))
    reps = int(_field(card_state, "reps", 0))
    lapses = int(_field(card_state, "lapses", 0))

    if rating_lower == "hard":
        lapses += 1
        reps = 0
        interval = 0
        due = now + timedelta(minutes=10)
        ease = round(max(1.3, ease - 0.2), 2)
    elif rating_lower == "medium":
        reps += 1
        if reps == 1:
            interval = 1
        else:
            interval = max(interval + 1, _round_half_up(interval * 1.2))
        interval = min(365, interval)
        ease = round(max(1.3, ease - 0.05), 2)
        due = now + timedelta(days=interval)
    else:  # easy
        reps += 1
        if reps == 1:
            interval = 1
        elif reps == 2:
            interval = 4
        else:
            interval = _round_half_up(interval * ease)
        interval = min(365, interval)
        ease = round(ease + 0.1, 2)
        due = now + timedelta(days=interval)

    raw_diff = 1 + lapses + (2.5 - ease) * 4
    difficulty = max(1, min(5, _round_half_up(raw_diff)))

    return CardScheduleState(
        ease=ease,
        interval_days=interval,
        reps=reps,
        lapses=lapses,
        due_at=due,
        last_reviewed_at=now,
        difficulty=difficulty,
    )
