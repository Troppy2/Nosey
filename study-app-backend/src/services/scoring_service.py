"""Weakness and improvement scoring for KojoCode struggle signals.

Both scorers read raw lc_struggle_events + lc_test_runs directly (there is no
rollup table, matching the rest of KojoCode's design). Stateless: session is
passed per call, nothing is cached on the instance.

Improvement's 7-day window is a superset of weakness's 3-day window, so
get_scores() fetches events + runs once for the wider window and both scorers
slice the piece they need from it in Python, rather than each running its own
overlapping query.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.lc_sync import LCStruggleEvent, LCTestRun
from src.schemas.leetcode_schema import (
    LCImprovementResponse,
    LCImprovementTopic,
    LCScoresResponse,
    LCWeaknessResponse,
    LCWeaknessTopic,
)

# Struggle event types. This is a stringly-typed contract between the producer
# (routes/leetcode.py, which logs these on hint/grade/timer/drill actions) and the
# scorers below that read them back -- both sides import these constants rather
# than re-typing the literals, so a typo fails at import time, not silently.
EVENT_HINT_USED = "hint_used"
EVENT_FAILED_GRADE = "failed_grade"
EVENT_TIMER_EXPIRY = "timer_expiry"
EVENT_DRILL_ADVANCED_2 = "drill_advanced_2"
EVENT_DRILL_ADVANCED_3 = "drill_advanced_3"
EVENT_DRILL_COMPLETED = "drill_completed"

# ── Weakness ────────────────────────────────────────────────────────────────

WEAKNESS_LOOKBACK_DAYS = 3
# A problem stays "in exploration" (struggle events add no weight) until the user
# has run its code at least this many times, ever. Cumulative rather than
# window-limited: a problem explored before the lookback window isn't "new" just
# because the run happened outside it.
GRACE_RUN_COUNT = 2
EXPLORATORY_HINT_WEIGHT = 0.3
STRUGGLE_EVENT_WEIGHT = 1.0
SUCCESS_REDUCTION = 0.5
# Bucketed score -> level 1-5. Starting thresholds, not tuned against real usage
# data yet; easy to adjust later.
_WEAKNESS_LEVEL_BUCKETS = ((2, 2), (4, 3), (7, 4))

# ── Improvement ─────────────────────────────────────────────────────────────

IMPROVEMENT_LOOKBACK_DAYS = 7
IMPROVEMENT_RECENT_DAYS = 3
IMPROVEMENT_PASS_RATE_MIN_DELTA = 0.3
IMPROVEMENT_THRESHOLD = 30


def _weakness_level_for_score(score: float) -> int:
    if score <= 0:
        return 1
    for ceiling, level in _WEAKNESS_LEVEL_BUCKETS:
        if score <= ceiling:
            return level
    return 5


class ScoringService:
    async def get_scores(self, session: AsyncSession, user_id: int) -> LCScoresResponse:
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=IMPROVEMENT_LOOKBACK_DAYS)

        events = (
            await session.execute(
                select(
                    LCStruggleEvent.topic,
                    LCStruggleEvent.event_type,
                    LCStruggleEvent.problem_slug,
                    LCStruggleEvent.occurred_at,
                )
                .where(LCStruggleEvent.user_id == user_id, LCStruggleEvent.occurred_at >= since)
                .order_by(LCStruggleEvent.occurred_at.asc())
            )
        ).all()
        runs = (
            await session.execute(
                select(LCTestRun.topic, LCTestRun.problem_slug, LCTestRun.passed, LCTestRun.difficulty, LCTestRun.run_at)
                .where(LCTestRun.user_id == user_id, LCTestRun.run_at >= since)
                .order_by(LCTestRun.run_at.asc())
            )
        ).all()

        weakness = await self._score_weakness(session, user_id, now, events, runs)
        improvement = self._score_improvement(now, events, runs)
        return LCScoresResponse(weakness=weakness, improvement=improvement)

    async def _score_weakness(self, session, user_id, now, events, runs) -> LCWeaknessResponse:
        weakness_since = now - timedelta(days=WEAKNESS_LOOKBACK_DAYS)
        window_events = [e for e in events if e.occurred_at >= weakness_since]
        if not window_events:
            return LCWeaknessResponse(topics=[])
        passed_runs = [r for r in runs if r.passed and r.run_at >= weakness_since]

        # Grace period lookup: total runs ever for each slug referenced this window.
        slugs = {slug for _topic, _event_type, slug, _occurred_at in window_events if slug}
        slugs.update(slug for _topic, slug, *_rest in passed_runs if slug)
        attempts_by_slug: dict[str, int] = {}
        if slugs:
            rows = (
                await session.execute(
                    select(LCTestRun.problem_slug, func.count())
                    .where(LCTestRun.user_id == user_id, LCTestRun.problem_slug.in_(slugs))
                    .group_by(LCTestRun.problem_slug)
                )
            ).all()
            attempts_by_slug = {slug: count for slug, count in rows}

        def past_grace(slug: str | None) -> bool:
            # No slug on the event (older timer_expiry rows) -> can't grace-check it,
            # so let it count rather than silently discard it.
            if not slug:
                return True
            return attempts_by_slug.get(slug, 0) >= GRACE_RUN_COUNT

        # Merge struggle events and passed runs into one chronological timeline so
        # the exploratory-hint and drill-reset rules see events in the order they
        # actually happened.
        timeline = [
            (occurred_at, "event", event_type, topic, slug)
            for topic, event_type, slug, occurred_at in window_events
        ] + [(run_at, "success", None, topic, slug) for topic, slug, _passed, _difficulty, run_at in passed_runs]
        timeline.sort(key=lambda item: item[0])

        scores: dict[str, float] = defaultdict(float)
        failed_seen: set[str] = set()  # problem_slugs with a failed_grade seen so far

        for _ts, kind, event_type, topic, slug in timeline:
            if not past_grace(slug):
                continue

            if kind == "success":
                scores[topic] = max(0.0, scores[topic] - SUCCESS_REDUCTION)
                continue

            if event_type == EVENT_DRILL_COMPLETED:
                scores[topic] = 0.0
                continue
            if event_type == EVENT_HINT_USED:
                weight = EXPLORATORY_HINT_WEIGHT if slug not in failed_seen else STRUGGLE_EVENT_WEIGHT
            elif event_type == EVENT_FAILED_GRADE:
                weight = STRUGGLE_EVENT_WEIGHT
                if slug:
                    failed_seen.add(slug)
            elif event_type == EVENT_TIMER_EXPIRY:
                weight = STRUGGLE_EVENT_WEIGHT
            else:
                # drill_advanced_2 / drill_advanced_3: improvement signals only, no
                # weakness weight.
                continue
            scores[topic] += weight

        scored = [
            LCWeaknessTopic(topic=topic, level=_weakness_level_for_score(score))
            for topic, score in scores.items()
            if score > 0
        ]
        scored.sort(key=lambda item: (-item.level, item.topic))
        return LCWeaknessResponse(topics=scored)

    def _score_improvement(self, now, events, runs) -> LCImprovementResponse:
        recent_start = now - timedelta(days=IMPROVEMENT_RECENT_DAYS)
        if not runs and not events:
            return LCImprovementResponse(topics=[])

        runs_by_topic: dict[str, list] = defaultdict(list)
        for row in runs:
            runs_by_topic[row.topic].append(row)
        hints_by_topic: dict[str, list] = defaultdict(list)
        drill_event_types_by_topic: dict[str, set[str]] = defaultdict(set)
        for topic, event_type, _slug, occurred_at in events:
            if event_type == EVENT_HINT_USED:
                hints_by_topic[topic].append(occurred_at)
            elif event_type in (EVENT_DRILL_ADVANCED_2, EVENT_DRILL_ADVANCED_3):
                drill_event_types_by_topic[topic].add(event_type)

        topics = set(runs_by_topic) | set(hints_by_topic) | set(drill_event_types_by_topic)

        result: list[LCImprovementTopic] = []
        for topic in topics:
            score = 0.0
            reasons: list[str] = []

            topic_runs = runs_by_topic[topic]
            recent_runs = [row for row in topic_runs if row.run_at >= recent_start]
            older_runs = [row for row in topic_runs if row.run_at < recent_start]

            # Signal 1: pass-rate trend (needs data on both sides to compare).
            if recent_runs and older_runs:
                recent_rate = sum(1 for r in recent_runs if r.passed) / len(recent_runs)
                older_rate = sum(1 for r in older_runs if r.passed) / len(older_runs)
                delta = recent_rate - older_rate
                if delta >= IMPROVEMENT_PASS_RATE_MIN_DELTA:
                    score += 40 * delta
                    reasons.append(
                        f"Pass rate improved from {round(older_rate * 100)}% to {round(recent_rate * 100)}%"
                    )

            # Signal 2: decreased hint usage.
            topic_hints = hints_by_topic[topic]
            hints_recent = sum(1 for ts in topic_hints if ts >= recent_start)
            hints_older = sum(1 for ts in topic_hints if ts < recent_start)
            if hints_older > 0 and hints_recent == 0:
                score += 25
                reasons.append(f"No hints needed recently (used {hints_older} earlier this week)")
            elif hints_older > 0 and hints_recent < hints_older:
                score += 25 * (1 - hints_recent / hints_older)
                reasons.append(f"Hint usage dropped from {hints_older} to {hints_recent}")

            # Signal 3: drill advancement anywhere in the 7-day window.
            topic_drill_events = drill_event_types_by_topic[topic]
            if EVENT_DRILL_ADVANCED_2 in topic_drill_events:
                score += 10
                reasons.append("Advanced a drill to pass 2")
            if EVENT_DRILL_ADVANCED_3 in topic_drill_events:
                score += 10
                reasons.append("Advanced a drill to pass 3")

            # Signal 4: solving harder problems than before.
            recent_hard_pass = any(r.passed and r.difficulty == "Hard" for r in recent_runs)
            older_only_easy_medium = bool(older_runs) and all(r.difficulty in ("Easy", "Medium") for r in older_runs)
            if recent_hard_pass and older_only_easy_medium:
                score += 15
                reasons.append("Solved a Hard problem after previously only Easy/Medium")

            score = min(100.0, score)
            if score >= IMPROVEMENT_THRESHOLD:
                result.append(LCImprovementTopic(topic=topic, score=round(score), reasons=reasons))

        result.sort(key=lambda item: (-item.score, item.topic))
        return LCImprovementResponse(topics=result)
