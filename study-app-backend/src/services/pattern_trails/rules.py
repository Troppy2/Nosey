"""Pattern Trails game rules. Pure: no DB, no clock reads (callers pass `now`), no
randomness of their own (callers pass `rng`). Every rule in spec section 4 lives
here so it can be tested without a database; the service only loads rows, calls
these, and writes the result.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, Hashable, Iterable, Optional, Sequence, TypeVar

T = TypeVar("T")

STEPS_PER_PATH = 5

LOCKED = "locked"
OPEN = "open"
PASSED = "passed"

# Q5 (2026-11-25): limits come from the difficulty unless a step overrides them.
DEFAULT_TIME_LIMITS_S = {"easy": 15 * 60, "medium": 25 * 60, "hard": 40 * 60}
SLOW_FRACTION = 0.8

REDO_INTERVALS = (timedelta(days=1), timedelta(days=7), timedelta(days=21))

GATE_SIZE = 5
GATE_PASS_CORRECT = 4
GATE_MIN_OWN = 3
GATE_LOCK = timedelta(hours=24)

WEAK_MIN_SAMPLES = 5
WEAK_RECOGNITION_BELOW = 0.6
WEAK_SOLVE_BELOW = 0.5


# ── Steps and paths ───────────────────────────────────────────────────────────


def step_time_limit(difficulty: Optional[str], override_s: Optional[int]) -> int:
    if override_s is not None and override_s > 0:
        return int(override_s)
    return DEFAULT_TIME_LIMITS_S.get((difficulty or "").strip().lower(), DEFAULT_TIME_LIMITS_S["medium"])


def step_states(lesson_watched: bool, passed_positions: Iterable[int], count: int = STEPS_PER_PATH) -> list[str]:
    """States for positions 1..count. Step 1 opens once the lesson is watched; step
    N+1 opens once step N is passed. A passed step stays passed even if content was
    edited around it."""
    passed = set(passed_positions)
    states: list[str] = []
    for position in range(1, count + 1):
        if position in passed:
            states.append(PASSED)
        elif lesson_watched and (position == 1 or (position - 1) in passed):
            states.append(OPEN)
        else:
            states.append(LOCKED)
    return states


def locked_reason(position: int, lesson_watched: bool) -> str:
    """What a locked stop says opens it (spec section 14, WP4)."""
    if not lesson_watched:
        return "Watch the lesson first"
    return f"Pass step {position - 1} first"


def path_finished(states: Sequence[str]) -> bool:
    return bool(states) and all(state == PASSED for state in states)


def subtopic_open(index: int, finished_flags: Sequence[bool]) -> bool:
    """Topics are free; subtopics open in order: every earlier path must be finished."""
    return index == 0 or all(finished_flags[:index])


def gate_open(finished_flags: Sequence[bool]) -> bool:
    return bool(finished_flags) and all(finished_flags)


def is_pass(pass_number: int, accepted: bool, seconds: int, limit_s: int) -> bool:
    """Only pass 3 (blank editor) with every test accepted inside the limit passes."""
    return pass_number == 3 and accepted and 0 <= seconds <= limit_s


def is_slow(seconds: int, limit_s: int) -> bool:
    return seconds > SLOW_FRACTION * limit_s


# ── Redos ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RedoNext:
    interval_index: int
    due_at: Optional[datetime]
    retired: bool


def first_redo(now: datetime) -> RedoNext:
    """A new failure (or slow pass) schedules a redo at the first interval. It also
    replaces any live redo on the same problem (reset to 0)."""
    return RedoNext(0, now + REDO_INTERVALS[0], False)


def next_redo(interval_index: int, passed_in_time: bool, now: datetime) -> RedoNext:
    """After a redo: a pass advances to the next interval, passing the last one retires
    it, a fail resets to the first interval."""
    if not passed_in_time:
        return first_redo(now)
    nxt = interval_index + 1
    if nxt >= len(REDO_INTERVALS):
        return RedoNext(interval_index, None, True)
    return RedoNext(nxt, now + REDO_INTERVALS[nxt], False)


# ── Topic gate ────────────────────────────────────────────────────────────────


def gate_passed(correct_count: int) -> bool:
    return correct_count >= GATE_PASS_CORRECT


def gate_lock_until(now: datetime) -> datetime:
    return now + GATE_LOCK


class NotEnoughGateItems(ValueError):
    pass


def draw_gate_items(
    own: Sequence[T],
    others: Sequence[T],
    rng: random.Random,
    *,
    key: Callable[[T], Hashable] = lambda item: item,
    size: int = GATE_SIZE,
    min_own: int = GATE_MIN_OWN,
) -> list[T]:
    """Draw `size` items: at least `min_own` from the topic's own patterns, the rest
    from `others` (distractors and patterns from finished topics). Nothing repeats
    (by `key`, e.g. the problem slug). Raises NotEnoughGateItems when the pools are
    too small to make a full, valid draw."""
    own_unique = _unique(own, key)
    own_keys = {key(item) for item in own_unique}
    others_unique = [item for item in _unique(others, key) if key(item) not in own_keys]
    if len(own_unique) < min_own or len(own_unique) + len(others_unique) < size:
        raise NotEnoughGateItems(
            f"Need {size} gate items with at least {min_own} from the topic; "
            f"have {len(own_unique)} own and {len(others_unique)} others."
        )
    others_take = min(size - min_own, len(others_unique))
    picked = rng.sample(others_unique, others_take) + rng.sample(own_unique, size - others_take)
    rng.shuffle(picked)
    return picked


def _unique(items: Sequence[T], key: Callable[[T], Hashable]) -> list[T]:
    seen: set[Hashable] = set()
    out: list[T] = []
    for item in items:
        k = key(item)
        if k not in seen:
            seen.add(k)
            out.append(item)
    return out


# ── Stats ─────────────────────────────────────────────────────────────────────


@dataclass
class PatternStat:
    """Recognition = correct gate picks / picks whose right answer is this pattern.
    Solve rate = steps passed on the first pass-3 attempt / steps attempted."""

    key: str
    picks: int = 0
    correct_picks: int = 0
    solve_attempts: int = 0
    solve_first_try: int = 0

    @property
    def recognition(self) -> Optional[float]:
        return self.correct_picks / self.picks if self.picks else None

    @property
    def solve_rate(self) -> Optional[float]:
        return self.solve_first_try / self.solve_attempts if self.solve_attempts else None

    @property
    def weak_recognition(self) -> bool:
        rec = self.recognition
        return self.picks >= WEAK_MIN_SAMPLES and rec is not None and rec < WEAK_RECOGNITION_BELOW

    @property
    def weak_solve(self) -> bool:
        rate = self.solve_rate
        return self.solve_attempts >= WEAK_MIN_SAMPLES and rate is not None and rate < WEAK_SOLVE_BELOW

    @property
    def weak(self) -> bool:
        return self.weak_recognition or self.weak_solve


def merge_stats(key: str, stats: Iterable[PatternStat]) -> PatternStat:
    total = PatternStat(key)
    for stat in stats:
        total.picks += stat.picks
        total.correct_picks += stat.correct_picks
        total.solve_attempts += stat.solve_attempts
        total.solve_first_try += stat.solve_first_try
    return total


def weakest_pattern(stats: Iterable[PatternStat]) -> Optional[PatternStat]:
    """The weak pattern to name on the map's side card: lowest recognition first
    (the feature's point), then lowest solve rate."""
    weak = [stat for stat in stats if stat.weak]
    if not weak:
        return None

    def rank(stat: PatternStat) -> tuple[float, float]:
        rec = stat.recognition if stat.weak_recognition else 1.0
        solve = stat.solve_rate if stat.weak_solve else 1.0
        return (rec if rec is not None else 1.0, solve if solve is not None else 1.0)

    return min(weak, key=rank)
