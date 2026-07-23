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
# Self-report / give-up signals. These fire at the moment of completion (the user
# just marked done, or is about to), so they must NOT be cancellable by that solve
# and they skip the exploration grace period -- an explicit "I couldn't do this" or
# "that felt brutal" is a deliberate judgment, not a barely-attempted problem.
EVENT_SOLUTION_VIEWED = "solution_viewed"
EVENT_SELF_RATED_EASY = "self_rated_easy"
EVENT_SELF_RATED_MEDIUM = "self_rated_medium"
EVENT_SELF_RATED_HARD = "self_rated_hard"
EVENT_SELF_RATED_BRUTAL = "self_rated_brutal"

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
# Silent struggle: a failed test run (grinding a problem with no hint/grade) adds a
# little weight so topics the user quietly wrestles with still surface. Capped per
# problem so one long grind can't dominate a topic. Scaled by sensitivity below.
FAILED_RUN_WEIGHT = 0.25
FAILED_RUN_CAP_PER_SLUG = 1.0
# Give-up / self-report weights. Viewing the solution and rating a problem hard are
# strong "I don't have this yet" signals; brutal is stronger than hard. Rating a
# problem easy is a self-reported win that trims the topic like a solve does.
SOLUTION_VIEW_WEIGHT = 1.0
SELF_RATED_HARD_WEIGHT = 1.0
SELF_RATED_BRUTAL_WEIGHT = 1.75
SELF_RATED_EASY_REDUCTION = 0.5
# Event types that skip the grace period and are non-cancellable by a later solve
# (they fire at completion, so a cancellable weight would be refunded immediately).
_SELF_REPORT_EVENTS = frozenset(
    {
        EVENT_SOLUTION_VIEWED,
        EVENT_SELF_RATED_EASY,
        EVENT_SELF_RATED_MEDIUM,
        EVENT_SELF_RATED_HARD,
        EVENT_SELF_RATED_BRUTAL,
    }
)
# Sensitivity multiplier applied to the final per-topic score before bucketing, and
# to the failed-run weight. Low needs sustained struggle to flag; High surfaces
# marginal topics fast. User-tunable from the KojoCode cog.
_SENSITIVITY_MULTIPLIER = {"low": 0.6, "medium": 1.0, "high": 1.6}
# Below this adjusted score a topic is not shown at all (lets Low hide marginal
# topics; High still surfaces them because the multiplier lifts them over the line).
MIN_VISIBLE_SCORE = 0.75
# Bucketed score -> level 1-5. Starting thresholds, not tuned against real usage
# data yet; easy to adjust later. Same for the sensitivity/failed-run constants above.
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


def _sensitivity_multiplier(sensitivity: str | None) -> float:
    return _SENSITIVITY_MULTIPLIER.get((sensitivity or "medium").lower(), 1.0)


class ScoringService:
    async def get_scores(
        self,
        session: AsyncSession,
        user_id: int,
        sensitivity: str = "medium",
        slug_scope: set[str] | None = None,
        reset_at: datetime | None = None,
    ) -> LCScoresResponse:
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

        # Bank scope (A4): restrict weakness to the bank's own problem slugs. Events
        # without a slug can't be attributed to a bank, so they drop out of scope.
        if slug_scope is not None:
            weakness_events = [e for e in events if e.problem_slug in slug_scope]
            weakness_runs = [r for r in runs if r.problem_slug in slug_scope]
        else:
            weakness_events = events
            weakness_runs = runs

        weakness = await self._score_weakness(
            session, user_id, now, weakness_events, weakness_runs, sensitivity, reset_at
        )
        # Improvement stays global (bank scope and reset are weakness-only concerns).
        improvement = self._score_improvement(now, events, runs)
        return LCScoresResponse(weakness=weakness, improvement=improvement)

    async def _score_weakness(
        self, session, user_id, now, events, runs, sensitivity="medium", reset_at=None
    ) -> LCWeaknessResponse:
        weakness_since = now - timedelta(days=WEAKNESS_LOOKBACK_DAYS)
        # Clear weakness signals (Part E): ignore everything before the reset marker.
        if reset_at is not None and reset_at > weakness_since:
            weakness_since = reset_at
        window_events = [e for e in events if e.occurred_at >= weakness_since]
        window_failed_runs = [r for r in runs if not r.passed and r.run_at >= weakness_since]
        if not window_events and not window_failed_runs:
            return LCWeaknessResponse(topics=[])
        passed_runs = [r for r in runs if r.passed and r.run_at >= weakness_since]
        mult = _sensitivity_multiplier(sensitivity)

        # Grace period lookup: total runs ever for each slug referenced this window
        # (struggle events, passed runs, and failed runs all reference slugs).
        slugs = {slug for _topic, _event_type, slug, _occurred_at in window_events if slug}
        slugs.update(slug for _topic, slug, *_rest in passed_runs if slug)
        slugs.update(r.problem_slug for r in window_failed_runs if r.problem_slug)
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

        # Merge struggle events, passed runs, and failed runs into one chronological
        # timeline so the exploratory-hint, solve-cancel, and drill-reset rules see
        # events in the order they actually happened.
        timeline = (
            [
                (occurred_at, "event", event_type, topic, slug)
                for topic, event_type, slug, occurred_at in window_events
            ]
            + [(run_at, "success", None, topic, slug) for topic, slug, _passed, _difficulty, run_at in passed_runs]
            + [(r.run_at, "failed", None, r.topic, r.problem_slug) for r in window_failed_runs]
        )
        timeline.sort(key=lambda item: item[0])

        scores: dict[str, float] = defaultdict(float)
        failed_seen: set[str] = set()  # problem_slugs with a failed_grade seen so far
        # Weight this window contributed per (topic, slug), so solving a problem can
        # cancel the struggle it caused (fixes topics staying "weak" after you grind
        # them out with hints and eventually pass).
        slug_weight: dict[tuple[str, str], float] = defaultdict(float)
        # Cumulative silent-struggle weight already added per slug, to enforce the cap.
        failed_run_added: dict[str, float] = defaultdict(float)

        for _ts, kind, event_type, topic, slug in timeline:
            # Self-report / give-up events bypass the grace period; everything else
            # must clear it (barely-attempted problems don't count).
            if event_type not in _SELF_REPORT_EVENTS and not past_grace(slug):
                continue

            if kind == "success":
                # A pass refunds the struggle this problem caused, plus a small bonus,
                # so repeated solving of a topic trends it toward mastery.
                refund = SUCCESS_REDUCTION
                if slug:
                    refund += slug_weight.pop((topic, slug), 0.0)
                scores[topic] = max(0.0, scores[topic] - refund)
                continue

            if kind == "failed":
                # Silent struggle: grinding a problem without asking for help. Capped
                # per slug so one long grind can't dominate a topic.
                if not slug:
                    continue
                room = FAILED_RUN_CAP_PER_SLUG - failed_run_added[slug]
                add = min(FAILED_RUN_WEIGHT, room)
                if add <= 0:
                    continue
                failed_run_added[slug] += add
                scores[topic] += add
                slug_weight[(topic, slug)] += add
                continue

            if event_type == EVENT_DRILL_COMPLETED:
                scores[topic] = 0.0
                continue

            # Self-report / give-up signals: non-cancellable (not added to
            # slug_weight), so the solve that fires alongside them can't refund them.
            if event_type == EVENT_SELF_RATED_EASY:
                scores[topic] = max(0.0, scores[topic] - SELF_RATED_EASY_REDUCTION)
                continue
            if event_type == EVENT_SELF_RATED_MEDIUM:
                continue  # logged for data, carries no weight either way
            if event_type == EVENT_SOLUTION_VIEWED:
                scores[topic] += SOLUTION_VIEW_WEIGHT
                continue
            if event_type == EVENT_SELF_RATED_HARD:
                scores[topic] += SELF_RATED_HARD_WEIGHT
                continue
            if event_type == EVENT_SELF_RATED_BRUTAL:
                scores[topic] += SELF_RATED_BRUTAL_WEIGHT
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
            if slug:
                slug_weight[(topic, slug)] += weight

        # Sensitivity scales the final score; MIN_VISIBLE hides marginal topics (so a
        # topic driven only by a little silent struggle stays hidden at Low but
        # surfaces at High). Level is bucketed off the adjusted score.
        scored = []
        for topic, score in scores.items():
            adjusted = score * mult
            if adjusted >= MIN_VISIBLE_SCORE:
                scored.append(LCWeaknessTopic(topic=topic, level=_weakness_level_for_score(adjusted)))
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
