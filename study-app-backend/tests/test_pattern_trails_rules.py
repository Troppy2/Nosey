"""Pattern Trails pure rules (spec sections 4 and 10)."""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

import pytest

from src.services.pattern_trails import rules
from src.services.pattern_trails.rules import LOCKED, OPEN, PASSED, PatternStat

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)


# ── Steps ─────────────────────────────────────────────────────────────────────


def test_lesson_gates_step_one() -> None:
    assert rules.step_states(False, []) == [LOCKED] * 5
    assert rules.step_states(True, []) == [OPEN, LOCKED, LOCKED, LOCKED, LOCKED]


def test_step_n_plus_one_opens_only_after_n() -> None:
    assert rules.step_states(True, [1]) == [PASSED, OPEN, LOCKED, LOCKED, LOCKED]
    assert rules.step_states(True, [1, 2, 3]) == [PASSED, PASSED, PASSED, OPEN, LOCKED]


def test_passed_step_stays_passed_without_lesson() -> None:
    # Content edits must never take a pass away.
    assert rules.step_states(False, [1]) == [PASSED, LOCKED, LOCKED, LOCKED, LOCKED]


def test_locked_reason_names_what_opens_it() -> None:
    assert rules.locked_reason(1, False) == "Watch the lesson first"
    assert rules.locked_reason(4, True) == "Pass step 3 first"


def test_path_finished_needs_every_step() -> None:
    assert not rules.path_finished(rules.step_states(True, [1, 2, 3, 4]))
    assert rules.path_finished(rules.step_states(True, [1, 2, 3, 4, 5]))
    assert not rules.path_finished([])


@pytest.mark.parametrize(
    ("difficulty", "override", "expected"),
    [("Easy", None, 900), ("medium", None, 1500), ("HARD", None, 2400), ("Hard", 600, 600), (None, None, 1500)],
)
def test_time_limit_by_difficulty_with_override(difficulty, override, expected) -> None:
    assert rules.step_time_limit(difficulty, override) == expected


def test_only_pass_three_inside_limit_passes() -> None:
    assert rules.is_pass(3, True, 1500, 1500)
    assert not rules.is_pass(3, True, 1501, 1500)  # over time
    assert not rules.is_pass(3, False, 100, 1500)  # tests failed
    assert not rules.is_pass(2, True, 100, 1500)  # practice pass
    assert not rules.is_pass(3, True, -1, 1500)


def test_slow_is_over_eighty_percent() -> None:
    assert not rules.is_slow(1200, 1500)
    assert rules.is_slow(1201, 1500)


# ── Subtopics and gate opening ────────────────────────────────────────────────


def test_subtopics_open_in_order() -> None:
    flags = [True, False, False]
    assert rules.subtopic_open(0, flags)
    assert rules.subtopic_open(1, flags)
    assert not rules.subtopic_open(2, flags)
    assert rules.subtopic_open(0, [False, False])


def test_gate_opens_only_when_every_subtopic_is_finished() -> None:
    assert not rules.gate_open([True, True, False])
    assert rules.gate_open([True, True, True])
    assert not rules.gate_open([])


# ── Redos ─────────────────────────────────────────────────────────────────────


def test_first_redo_is_one_day() -> None:
    nxt = rules.first_redo(NOW)
    assert (nxt.interval_index, nxt.due_at, nxt.retired) == (0, NOW + timedelta(days=1), False)


def test_redo_advances_one_seven_twenty_one_then_retires() -> None:
    step1 = rules.next_redo(0, True, NOW)
    assert (step1.interval_index, step1.due_at) == (1, NOW + timedelta(days=7))
    step2 = rules.next_redo(1, True, NOW)
    assert (step2.interval_index, step2.due_at) == (2, NOW + timedelta(days=21))
    done = rules.next_redo(2, True, NOW)
    assert done.retired and done.due_at is None


def test_failed_redo_resets_to_first_interval() -> None:
    nxt = rules.next_redo(2, False, NOW)
    assert (nxt.interval_index, nxt.due_at, nxt.retired) == (0, NOW + timedelta(days=1), False)


# ── Gate ──────────────────────────────────────────────────────────────────────


def test_gate_pass_at_four_fail_at_three() -> None:
    assert rules.gate_passed(4)
    assert rules.gate_passed(5)
    assert not rules.gate_passed(3)


def test_gate_lock_is_twenty_four_hours() -> None:
    assert rules.gate_lock_until(NOW) == NOW + timedelta(hours=24)


@pytest.mark.parametrize("seed", range(40))
def test_draw_has_no_repeats_and_keeps_three_own(seed: int) -> None:
    own = ["a1", "a2", "a3", "a4", "a5", "a6"]
    others = ["b1", "b2", "b3", "a1"]  # a1 also in own: must not appear twice
    drawn = rules.draw_gate_items(own, others, random.Random(seed))
    assert len(drawn) == 5
    assert len(set(drawn)) == 5
    assert sum(1 for item in drawn if item.startswith("a")) >= 3


def test_draw_dedupes_by_key() -> None:
    own = [{"id": 1, "slug": "x"}, {"id": 2, "slug": "x"}, {"id": 3, "slug": "y"}, {"id": 4, "slug": "z"}]
    others = [{"id": 5, "slug": "p"}, {"id": 6, "slug": "q"}]
    drawn = rules.draw_gate_items(own, others, random.Random(1), key=lambda item: item["slug"])
    slugs = [item["slug"] for item in drawn]
    assert len(slugs) == len(set(slugs)) == 5


def test_draw_fills_from_own_when_no_others() -> None:
    drawn = rules.draw_gate_items(["a1", "a2", "a3", "a4", "a5"], [], random.Random(0))
    assert sorted(drawn) == ["a1", "a2", "a3", "a4", "a5"]


def test_draw_refuses_small_pools() -> None:
    with pytest.raises(rules.NotEnoughGateItems):
        rules.draw_gate_items(["a1", "a2"], ["b1", "b2", "b3"], random.Random(0))
    with pytest.raises(rules.NotEnoughGateItems):
        rules.draw_gate_items(["a1", "a2", "a3"], ["b1"], random.Random(0))


# ── Stats ─────────────────────────────────────────────────────────────────────


def test_weak_needs_five_samples() -> None:
    assert not PatternStat("fixed", picks=4, correct_picks=0).weak
    assert PatternStat("fixed", picks=5, correct_picks=2).weak  # 40%
    assert not PatternStat("fixed", picks=5, correct_picks=3).weak  # 60%
    assert PatternStat("fixed", solve_attempts=5, solve_first_try=2).weak  # 40% solve
    assert not PatternStat("fixed", solve_attempts=4, solve_first_try=0).weak


def test_weakest_pattern_prefers_lowest_recognition() -> None:
    a = PatternStat("a", picks=5, correct_picks=2)
    b = PatternStat("b", picks=5, correct_picks=1)
    c = PatternStat("c", picks=5, correct_picks=5)
    assert rules.weakest_pattern([a, b, c]) is b
    assert rules.weakest_pattern([c]) is None


def test_merge_stats_sums() -> None:
    total = rules.merge_stats("t", [PatternStat("a", 2, 1, 3, 2), PatternStat("b", 3, 3, 1, 0)])
    assert (total.picks, total.correct_picks, total.solve_attempts, total.solve_first_try) == (5, 4, 4, 2)
    assert total.recognition == 0.8
