"""Pattern Trails DB service: loads content and the user's progress, applies the
pure rules (rules.py) and writes the result. Stateless, instantiated per request.

Content is small (a handful of topics, ~5 paths each, 5 steps per path) so each
call loads all of it in a few queries instead of joining per need.
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.lc_sync import LCActivityDate, LCProgress
from src.models.pattern_trail import (
    PTGateAnswer,
    PTGateAttempt,
    PTGateItem,
    PTRedo,
    PTStep,
    PTSubtopic,
    PTTopic,
    PTUserLesson,
    PTUserStep,
)
from src.schemas.pattern_trails_schema import (
    PTGateAttemptOut,
    PTGateItemOut,
    PTGateSolveResponse,
    PTGateState,
    PTLesson,
    PTMapResponse,
    PTPathResponse,
    PTPattern,
    PTRedoListResponse,
    PTRedoOut,
    PTRedoResultResponse,
    PTStats,
    PTStepOut,
    PTStepResultResponse,
    PTSubtopicSummary,
    PTTopicSummary,
    PTWeakest,
)
from src.services.pattern_trails import rules
from src.utils.exceptions import ResourceNotFoundException, StudyAppException


class TrailConflict(StudyAppException):
    """The action is not allowed in the current state (locked step, gate cooldown,
    redo not due yet...). Routes map it to 409."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands back naive datetimes even for timezone=True columns."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _cues(raw: str) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(cue) for cue in value if isinstance(cue, str)] if isinstance(value, list) else []


def _local_day(now: datetime, tz_offset_minutes: int) -> str:
    # tz_offset is Date.getTimezoneOffset(): minutes BEHIND UTC (same as mock interviews).
    return (now - timedelta(minutes=tz_offset_minutes)).strftime("%Y-%m-%d")


# ── Loaded state ──────────────────────────────────────────────────────────────


@dataclass
class _Content:
    topics: list[PTTopic]
    subtopics_by_topic: dict[int, list[PTSubtopic]]
    steps_by_subtopic: dict[int, list[PTStep]]
    subtopic_by_id: dict[int, PTSubtopic]
    topic_by_id: dict[int, PTTopic]
    step_by_id: dict[int, PTStep]


@dataclass
class _Progress:
    lessons: dict[int, PTUserLesson]
    user_steps: dict[int, PTUserStep]
    live_redos: list[PTRedo]
    # Computed: per subtopic id
    states: dict[int, list[str]] = field(default_factory=dict)
    finished: dict[int, bool] = field(default_factory=dict)
    open: dict[int, bool] = field(default_factory=dict)


class PatternTrailService:
    # ── Loading ───────────────────────────────────────────────────────────────

    async def _content(self, session: AsyncSession) -> _Content:
        topics = list(
            (await session.execute(select(PTTopic).order_by(PTTopic.sort_order, PTTopic.id))).scalars().all()
        )
        subtopics = (
            await session.execute(select(PTSubtopic).order_by(PTSubtopic.sort_order, PTSubtopic.id))
        ).scalars().all()
        steps = (await session.execute(select(PTStep).order_by(PTStep.position))).scalars().all()
        by_topic: dict[int, list[PTSubtopic]] = {topic.id: [] for topic in topics}
        for sub in subtopics:
            by_topic.setdefault(sub.topic_id, []).append(sub)
        by_sub: dict[int, list[PTStep]] = {sub.id: [] for sub in subtopics}
        for step in steps:
            by_sub.setdefault(step.subtopic_id, []).append(step)
        return _Content(
            topics=topics,
            subtopics_by_topic=by_topic,
            steps_by_subtopic=by_sub,
            subtopic_by_id={sub.id: sub for sub in subtopics},
            topic_by_id={topic.id: topic for topic in topics},
            step_by_id={step.id: step for step in steps},
        )

    async def _progress(self, session: AsyncSession, user_id: int, content: _Content) -> _Progress:
        lessons = {
            row.subtopic_id: row
            for row in (
                await session.execute(select(PTUserLesson).where(PTUserLesson.user_id == user_id))
            ).scalars().all()
        }
        user_steps = {
            row.step_id: row
            for row in (
                await session.execute(select(PTUserStep).where(PTUserStep.user_id == user_id))
            ).scalars().all()
        }
        redos = list(
            (
                await session.execute(
                    select(PTRedo)
                    .where(PTRedo.user_id == user_id, PTRedo.retired_at.is_(None))
                    .order_by(PTRedo.due_at)
                )
            ).scalars().all()
        )
        progress = _Progress(lessons=lessons, user_steps=user_steps, live_redos=redos)
        for topic in content.topics:
            finished_flags: list[bool] = []
            for index, sub in enumerate(content.subtopics_by_topic.get(topic.id, [])):
                steps = content.steps_by_subtopic.get(sub.id, [])
                passed = [
                    step.position
                    for step in steps
                    if (row := user_steps.get(step.id)) is not None and row.status == rules.PASSED
                ]
                states = rules.step_states(sub.id in lessons, passed, count=len(steps))
                progress.states[sub.id] = states
                progress.finished[sub.id] = rules.path_finished(states)
                progress.open[sub.id] = rules.subtopic_open(index, finished_flags)
                finished_flags.append(progress.finished[sub.id])
        return progress

    def _topic_finished(self, content: _Content, progress: _Progress, topic_id: int) -> bool:
        return rules.gate_open([progress.finished[sub.id] for sub in content.subtopics_by_topic.get(topic_id, [])])

    # ── Serializers ───────────────────────────────────────────────────────────

    def _redo_out(self, redo: PTRedo, content: _Content, now: datetime) -> PTRedoOut:
        step = content.step_by_id.get(redo.step_id) if redo.step_id else None
        sub = content.subtopic_by_id.get(step.subtopic_id) if step else None
        due_at = _aware(redo.due_at)
        return PTRedoOut(
            id=redo.id,
            problem_slug=redo.problem_slug,
            step_id=redo.step_id,
            subtopic_slug=sub.slug if sub else None,
            position=step.position if step else None,
            gate_item_id=redo.gate_item_id,
            time_limit_s=redo.time_limit_s,
            interval_index=redo.interval_index,
            due_at=due_at,
            due=due_at <= now,
            last_result=redo.last_result,
        )

    def _path_out(self, content: _Content, progress: _Progress, sub: PTSubtopic, now: datetime) -> PTPathResponse:
        topic = content.topic_by_id[sub.topic_id]
        siblings = content.subtopics_by_topic.get(topic.id, [])
        index = siblings.index(sub)
        is_open = progress.open[sub.id]
        lesson = progress.lessons.get(sub.id)
        watched = lesson is not None
        redo_by_step = {redo.step_id: redo for redo in progress.live_redos if redo.step_id}
        steps_out: list[PTStepOut] = []
        states = progress.states[sub.id]
        for step, state in zip(content.steps_by_subtopic.get(sub.id, []), states):
            row = progress.user_steps.get(step.id)
            redo = redo_by_step.get(step.id)
            steps_out.append(
                PTStepOut(
                    id=step.id,
                    position=step.position,
                    problem_slug=step.problem_slug,
                    difficulty=step.difficulty,
                    time_limit_s=rules.step_time_limit(step.difficulty, step.time_limit_s),
                    state=state,
                    locked_reason=rules.locked_reason(step.position, watched) if state == rules.LOCKED else None,
                    attempts=row.attempts if row else 0,
                    best_seconds=row.best_seconds if row else None,
                    passed_at=_aware(row.passed_at) if row else None,
                    redo=self._redo_out(redo, content, now) if redo else None,
                )
            )
        nxt = siblings[index + 1] if index + 1 < len(siblings) else None
        return PTPathResponse(
            topic_slug=topic.slug,
            topic_title=topic.title,
            slug=sub.slug,
            title=sub.title,
            summary=sub.summary,
            cues=_cues(sub.cues_json),
            template_code=sub.template_code,
            open=is_open,
            locked_reason=None if is_open else f"Finish {siblings[index - 1].title} first",
            lesson=PTLesson(lecture_slug=sub.lecture_slug, watched=watched, watched_at=_aware(lesson.watched_at) if lesson else None),
            steps=steps_out,
            finished=progress.finished[sub.id],
            solved_count=sum(1 for state in states if state == rules.PASSED),
            next_subtopic_slug=nxt.slug if nxt else None,
        )

    # ── Map ───────────────────────────────────────────────────────────────────

    async def get_map(self, session: AsyncSession, user_id: int) -> PTMapResponse:
        now = _utcnow()
        content = await self._content(session)
        progress = await self._progress(session, user_id, content)
        sub_stats = await self._pattern_stats(session, user_id, content, progress)
        attempts = await self._attempts_by_topic(session, user_id)

        topics_out: list[PTTopicSummary] = []
        current: Optional[str] = None
        first_unfinished: Optional[str] = None
        for topic in content.topics:
            subs = content.subtopics_by_topic.get(topic.id, [])
            finished = self._topic_finished(content, progress, topic.id)
            started = any(
                progress.finished[sub.id] or sub.id in progress.lessons for sub in subs
            )
            if not finished and first_unfinished is None:
                first_unfinished = topic.slug
            if started and not finished and current is None:
                current = topic.slug
            stats = [sub_stats[sub.id] for sub in subs]
            land = rules.merge_stats(topic.slug, stats)
            topics_out.append(
                PTTopicSummary(
                    slug=topic.slug,
                    title=topic.title,
                    icon_key=topic.icon_key,
                    subtopics=[
                        PTSubtopicSummary(
                            slug=sub.slug,
                            title=sub.title,
                            summary=sub.summary,
                            open=progress.open[sub.id],
                            finished=progress.finished[sub.id],
                            lesson_watched=sub.id in progress.lessons,
                            step_states=progress.states[sub.id],
                            passed_count=progress.states[sub.id].count(rules.PASSED),
                            stats=self._stats_out(sub_stats[sub.id]),
                        )
                        for sub in subs
                    ],
                    finished=finished,
                    gate=self._gate_state(finished, attempts.get(topic.id, []), now),
                    stats=PTStats(**{**self._stats_out(land).model_dump(), "weak": land.weak or any(s.weak for s in stats)}),
                )
            )

        weakest_stat = rules.weakest_pattern(sub_stats.values())
        weakest: Optional[PTWeakest] = None
        if weakest_stat is not None:
            sub = content.subtopic_by_id[int(weakest_stat.key)]
            weakest = PTWeakest(
                pattern=PTPattern(key=sub.slug, title=sub.title),
                topic_slug=content.topic_by_id[sub.topic_id].slug,
                kind="recognition" if weakest_stat.weak_recognition else "solve",
                recognition=weakest_stat.recognition,
                solve_rate=weakest_stat.solve_rate,
            )

        due = [self._redo_out(redo, content, now) for redo in progress.live_redos]
        return PTMapResponse(
            topics=topics_out,
            current_topic_slug=current or first_unfinished or (content.topics[-1].slug if content.topics else None),
            solved_total=sum(1 for row in progress.user_steps.values() if row.status == rules.PASSED),
            redos_due=[redo for redo in due if redo.due],
            redos_waiting=sum(1 for redo in due if not redo.due),
            weakest=weakest,
        )

    def _stats_out(self, stat: rules.PatternStat) -> PTStats:
        return PTStats(
            recognition=stat.recognition,
            picks=stat.picks,
            solve_rate=stat.solve_rate,
            solve_attempts=stat.solve_attempts,
            weak=stat.weak,
        )

    async def _pattern_stats(
        self, session: AsyncSession, user_id: int, content: _Content, progress: _Progress
    ) -> dict[int, rules.PatternStat]:
        """Per subtopic (keyed by its id as a string inside PatternStat)."""
        stats = {sub_id: rules.PatternStat(str(sub_id)) for sub_id in content.subtopic_by_id}
        for step_id, row in progress.user_steps.items():
            step = content.step_by_id.get(step_id)
            if step is None or row.first_try_passed is None:
                continue
            stat = stats[step.subtopic_id]
            stat.solve_attempts += 1
            stat.solve_first_try += 1 if row.first_try_passed else 0
        picks = (
            await session.execute(
                select(PTGateAnswer.correct, PTGateItem.right_subtopic_id)
                .join(PTGateAttempt, PTGateAttempt.id == PTGateAnswer.attempt_id)
                .join(PTGateItem, PTGateItem.id == PTGateAnswer.item_id)
                .where(PTGateAttempt.user_id == user_id, PTGateAnswer.picked_key.is_not(None))
            )
        ).all()
        for correct, right_subtopic_id in picks:
            if right_subtopic_id in stats:
                stats[right_subtopic_id].picks += 1
                stats[right_subtopic_id].correct_picks += 1 if correct else 0
        return stats

    async def _attempts_by_topic(self, session: AsyncSession, user_id: int) -> dict[int, list[PTGateAttempt]]:
        rows = (
            await session.execute(
                select(PTGateAttempt).where(PTGateAttempt.user_id == user_id).order_by(PTGateAttempt.id)
            )
        ).scalars().all()
        out: dict[int, list[PTGateAttempt]] = {}
        for row in rows:
            out.setdefault(row.topic_id, []).append(row)
        return out

    def _gate_state(self, finished: bool, attempts: list[PTGateAttempt], now: datetime) -> PTGateState:
        cleared = any(attempt.passed for attempt in attempts)
        best = max((attempt.correct_count for attempt in attempts if attempt.finished_at), default=None)
        base = dict(cleared=cleared, need=rules.GATE_PASS_CORRECT, size=rules.GATE_SIZE, best_correct=best)
        if not finished:
            return PTGateState(state="locked", **base)
        live = next((attempt for attempt in reversed(attempts) if attempt.finished_at is None), None)
        if live is not None:
            return PTGateState(state="in_progress", attempt_id=live.id, **base)
        last = attempts[-1] if attempts else None
        locked_until = _aware(last.locked_until) if last else None
        if last is not None and not last.passed and locked_until and locked_until > now:
            return PTGateState(state="cooldown", locked_until=locked_until, **base)
        return PTGateState(state="open", **base)

    # ── Path ──────────────────────────────────────────────────────────────────

    async def _subtopic(self, content: _Content, slug: str) -> PTSubtopic:
        sub = next((sub for sub in content.subtopic_by_id.values() if sub.slug == slug), None)
        if sub is None:
            raise ResourceNotFoundException("Path")
        return sub

    async def get_path(self, session: AsyncSession, user_id: int, slug: str) -> PTPathResponse:
        content = await self._content(session)
        sub = await self._subtopic(content, slug)
        progress = await self._progress(session, user_id, content)
        return self._path_out(content, progress, sub, _utcnow())

    async def mark_lesson_watched(self, session: AsyncSession, user_id: int, slug: str) -> PTPathResponse:
        now = _utcnow()
        content = await self._content(session)
        sub = await self._subtopic(content, slug)
        progress = await self._progress(session, user_id, content)
        if not progress.open[sub.id]:
            raise TrailConflict("Finish the earlier paths first.")
        if sub.id not in progress.lessons:
            session.add(PTUserLesson(user_id=user_id, subtopic_id=sub.id, watched_at=now))
            await session.commit()
            progress = await self._progress(session, user_id, content)
        return self._path_out(content, progress, sub, now)

    # ── Step results ──────────────────────────────────────────────────────────

    async def _step_context(self, session: AsyncSession, user_id: int, step_id: int):
        content = await self._content(session)
        step = content.step_by_id.get(step_id)
        if step is None:
            raise ResourceNotFoundException("Step")
        sub = content.subtopic_by_id[step.subtopic_id]
        progress = await self._progress(session, user_id, content)
        if not progress.open[sub.id]:
            raise TrailConflict("Finish the earlier paths first.")
        state = progress.states[sub.id][content.steps_by_subtopic[sub.id].index(step)]
        if state == rules.LOCKED:
            raise TrailConflict(rules.locked_reason(step.position, sub.id in progress.lessons))
        return content, step, sub, progress

    async def record_step_result(
        self,
        session: AsyncSession,
        user_id: int,
        step_id: int,
        *,
        pass_number: int = 3,
        accepted: bool,
        seconds: int,
        tz_offset_minutes: int,
    ) -> PTStepResultResponse:
        """The step's one timed solve. In time and accepted: the step waits on the
        write-up (nothing is counted yet). Otherwise it fails now and gets a redo."""
        now = _utcnow()
        content, step, sub, progress = await self._step_context(session, user_id, step_id)
        limit = rules.step_time_limit(step.difficulty, step.time_limit_s)
        row = progress.user_steps.get(step.id)
        if row is None:
            row = PTUserStep(user_id=user_id, step_id=step.id, status=rules.OPEN, attempts=0, writeup_tries=0)
            session.add(row)
        row.attempts = (row.attempts or 0) + 1
        if rules.solved_in_time(accepted, seconds, limit):
            row.pending_seconds = seconds
            row.writeup_tries = 0
            await session.commit()
            return PTStepResultResponse(
                passed=False, slow=False, solved_delta=0, needs_writeup=True,
                path_finished=progress.finished[sub.id], gate_opened=False,
                path=self._path_out(content, progress, sub, now),
            )
        return await self._settle_step(
            session, user_id, content, step, sub, progress, row,
            passed=False, seconds=seconds, tz_offset_minutes=tz_offset_minutes, now=now,
        )

    async def pending_writeup(self, session: AsyncSession, user_id: int, step_id: int) -> PTStep:
        """The step, when a solve is waiting on its write-up (checked before Kojo grades,
        so no Kojo call is spent on a write-up that cannot count)."""
        _, step, _, progress = await self._step_context(session, user_id, step_id)
        row = progress.user_steps.get(step.id)
        if row is None or row.pending_seconds is None:
            raise TrailConflict("Solve the problem first, then explain it.")
        return step

    async def record_step_writeup(
        self, session: AsyncSession, user_id: int, step_id: int, *, ok: Optional[bool], tz_offset_minutes: int
    ) -> tuple[PTStepResultResponse, int]:
        """Settles a pending solve. ok=None means Kojo could not grade: the tests carry
        it. A weak write-up gets one retry; the second miss fails the step (redo).
        Returns (result, tries left)."""
        now = _utcnow()
        content, step, sub, progress = await self._step_context(session, user_id, step_id)
        row = progress.user_steps.get(step.id)
        if row is None or row.pending_seconds is None:
            raise TrailConflict("Solve the problem first, then explain it.")
        seconds = row.pending_seconds
        if ok is False:
            row.writeup_tries = (row.writeup_tries or 0) + 1
            left = max(0, rules.WRITEUP_TRIES - row.writeup_tries)
            if left:
                await session.commit()
                return PTStepResultResponse(
                    passed=False, slow=False, solved_delta=0, needs_writeup=True,
                    path_finished=progress.finished[sub.id], gate_opened=False,
                    path=self._path_out(content, progress, sub, now),
                ), left
        row.pending_seconds = None
        result = await self._settle_step(
            session, user_id, content, step, sub, progress, row,
            passed=ok is not False, seconds=seconds, tz_offset_minutes=tz_offset_minutes, now=now,
        )
        return result, 0

    async def _settle_step(
        self, session: AsyncSession, user_id: int, content, step, sub, progress, row: PTUserStep,
        *, passed: bool, seconds: int, tz_offset_minutes: int, now: datetime,
    ) -> PTStepResultResponse:
        was_finished = progress.finished[sub.id]
        gate_was_open = self._topic_finished(content, progress, sub.topic_id)
        limit = rules.step_time_limit(step.difficulty, step.time_limit_s)
        slow = passed and rules.is_slow(seconds, limit)
        if row.first_try_passed is None:
            row.first_try_passed = passed

        solved_delta = 0
        walked_to: Optional[int] = None
        if passed:
            row.best_seconds = seconds if row.best_seconds is None else min(row.best_seconds, seconds)
            if row.status != rules.PASSED:
                row.status = rules.PASSED
                row.passed_at = now
                solved_delta = 1
                walked_to = step.position
                await self._count_solved(session, user_id, step.problem_slug, now, tz_offset_minutes)

        redo: Optional[PTRedo] = None
        if not passed or slow:
            redo = await self._schedule_redo(
                session, user_id, step.problem_slug, limit, now,
                last_result="slow" if passed else "failed", step_id=step.id,
            )
        await session.commit()

        progress = await self._progress(session, user_id, content)
        finished_now = progress.finished[sub.id]
        siblings = content.subtopics_by_topic[sub.topic_id]
        index = siblings.index(sub)
        next_opened = (
            siblings[index + 1].slug
            if finished_now and not was_finished and index + 1 < len(siblings)
            else None
        )
        return PTStepResultResponse(
            passed=passed,
            slow=slow,
            solved_delta=solved_delta,
            walked_to=walked_to,
            redo=self._redo_out(redo, content, now) if redo else None,
            path_finished=finished_now,
            next_subtopic_opened=next_opened,
            gate_opened=not gate_was_open and self._topic_finished(content, progress, sub.topic_id),
            path=self._path_out(content, progress, sub, now),
        )

    async def _count_solved(
        self, session: AsyncSession, user_id: int, slug: str, now: datetime, tz_offset_minutes: int
    ) -> None:
        """+1 solved in KojoCode: mark the problem done (keeping its first-solve stamp)
        and add one to today's tally. Q2 (2026-11-25): the tally goes up even when the
        problem was already solved before."""
        progress = (
            await session.execute(
                select(LCProgress).where(LCProgress.user_id == user_id, LCProgress.problem_slug == slug)
            )
        ).scalar_one_or_none()
        if progress is None:
            session.add(LCProgress(user_id=user_id, problem_slug=slug, done=True, solved_at=now))
        else:
            progress.done = True
            if progress.solved_at is None:
                progress.solved_at = now
        day = _local_day(now, tz_offset_minutes)
        activity = (
            await session.execute(
                select(LCActivityDate).where(LCActivityDate.user_id == user_id, LCActivityDate.activity_date == day)
            )
        ).scalar_one_or_none()
        if activity is None:
            session.add(LCActivityDate(user_id=user_id, activity_date=day, count=1))
        else:
            activity.count += 1

    async def _schedule_redo(
        self,
        session: AsyncSession,
        user_id: int,
        slug: str,
        limit_s: int,
        now: datetime,
        *,
        last_result: str,
        step_id: Optional[int] = None,
        gate_item_id: Optional[int] = None,
    ) -> PTRedo:
        """A new failure or slow solve: one live redo per problem, reset to the first
        interval (replacing any live one)."""
        nxt = rules.first_redo(now)
        live = (
            await session.execute(
                select(PTRedo).where(
                    PTRedo.user_id == user_id, PTRedo.problem_slug == slug, PTRedo.retired_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        if live is None:
            live = PTRedo(user_id=user_id, problem_slug=slug)
            session.add(live)
        live.step_id = step_id
        live.gate_item_id = gate_item_id
        live.time_limit_s = limit_s
        live.interval_index = nxt.interval_index
        live.due_at = nxt.due_at
        live.last_result = last_result
        await session.flush()
        return live

    # ── Redos ─────────────────────────────────────────────────────────────────

    async def list_redos(self, session: AsyncSession, user_id: int) -> PTRedoListResponse:
        now = _utcnow()
        content = await self._content(session)
        progress = await self._progress(session, user_id, content)
        out = [self._redo_out(redo, content, now) for redo in progress.live_redos]
        return PTRedoListResponse(due=[r for r in out if r.due], waiting=[r for r in out if not r.due])

    async def record_redo_result(
        self, session: AsyncSession, user_id: int, redo_id: int, *, accepted: bool, seconds: int
    ) -> PTRedoResultResponse:
        now = _utcnow()
        redo = (
            await session.execute(
                select(PTRedo).where(PTRedo.id == redo_id, PTRedo.user_id == user_id, PTRedo.retired_at.is_(None))
            )
        ).scalar_one_or_none()
        if redo is None:
            raise ResourceNotFoundException("Redo")
        if _aware(redo.due_at) > now:
            raise TrailConflict("This redo is not due yet.")
        passed = accepted and 0 <= seconds <= redo.time_limit_s
        nxt = rules.next_redo(redo.interval_index, passed, now)
        redo.last_result = "passed" if passed else "failed"
        if nxt.retired:
            redo.retired_at = now
        else:
            redo.interval_index = nxt.interval_index
            redo.due_at = nxt.due_at
        await session.commit()
        content = await self._content(session)
        return PTRedoResultResponse(
            passed=passed,
            retired=nxt.retired,
            redo=None if nxt.retired else self._redo_out(redo, content, now),
        )

    # ── Gate ──────────────────────────────────────────────────────────────────

    def _right_pattern(self, item: PTGateItem, content: _Content) -> PTPattern:
        if item.right_subtopic_id is not None and item.right_subtopic_id in content.subtopic_by_id:
            sub = content.subtopic_by_id[item.right_subtopic_id]
            return PTPattern(key=sub.slug, title=sub.title)
        key = item.right_pattern_key or "unknown"
        return PTPattern(key=key, title=item.right_pattern_title or key)

    def _is_own(self, item: PTGateItem, content: _Content) -> bool:
        sub = content.subtopic_by_id.get(item.right_subtopic_id) if item.right_subtopic_id else None
        return sub is not None and sub.topic_id == item.topic_id

    async def _gate_pools(
        self, session: AsyncSession, content: _Content, progress: _Progress, topic: PTTopic
    ) -> tuple[list[PTGateItem], list[PTGateItem], list[PTPattern]]:
        """own = this topic's items whose answer is one of its paths; others = its
        distractors plus the own items of topics the user has finished. Options = the
        topic's patterns, then the finished topics' patterns and the distractor patterns."""
        items = (await session.execute(select(PTGateItem).order_by(PTGateItem.id))).scalars().all()
        finished_topics = {
            t.id for t in content.topics if t.id != topic.id and self._topic_finished(content, progress, t.id)
        }
        own: list[PTGateItem] = []
        others: list[PTGateItem] = []
        for item in items:
            if item.topic_id == topic.id:
                (own if self._is_own(item, content) else others).append(item)
            elif item.topic_id in finished_topics and self._is_own(item, content):
                others.append(item)

        options: list[PTPattern] = [
            PTPattern(key=sub.slug, title=sub.title) for sub in content.subtopics_by_topic.get(topic.id, [])
        ]
        extra: dict[str, PTPattern] = {}
        for t in content.topics:
            if t.id in finished_topics:
                for sub in content.subtopics_by_topic.get(t.id, []):
                    extra[sub.slug] = PTPattern(key=sub.slug, title=sub.title)
        for item in items:
            if item.topic_id == topic.id and not self._is_own(item, content):
                pattern = self._right_pattern(item, content)
                extra.setdefault(pattern.key, pattern)
        own_keys = {option.key for option in options}
        options += sorted((p for k, p in extra.items() if k not in own_keys), key=lambda p: p.title.lower())
        return own, others, options

    async def _topic(self, content: _Content, slug: str) -> PTTopic:
        topic = next((topic for topic in content.topics if topic.slug == slug), None)
        if topic is None:
            raise ResourceNotFoundException("Topic")
        return topic

    async def start_gate(
        self, session: AsyncSession, user_id: int, topic_slug: str, rng: Optional[random.Random] = None
    ) -> PTGateAttemptOut:
        now = _utcnow()
        content = await self._content(session)
        topic = await self._topic(content, topic_slug)
        progress = await self._progress(session, user_id, content)
        if not self._topic_finished(content, progress, topic.id):
            raise TrailConflict(f"Finish every path in {topic.title} first.")
        attempts = (await self._attempts_by_topic(session, user_id)).get(topic.id, [])
        live = next((attempt for attempt in reversed(attempts) if attempt.finished_at is None), None)
        if live is not None:
            # Resume instead of drawing again, so reopening cannot reshuffle the items.
            return await self._attempt_out(session, content, progress, live)
        last = attempts[-1] if attempts else None
        locked_until = _aware(last.locked_until) if last else None
        if last is not None and not last.passed and locked_until and locked_until > now:
            raise TrailConflict("This gate opens again 24 hours after a miss.")

        own, others, _ = await self._gate_pools(session, content, progress, topic)
        try:
            drawn = rules.draw_gate_items(own, others, rng or random.Random(), key=lambda item: item.problem_slug)
        except rules.NotEnoughGateItems as exc:
            raise TrailConflict("This gate is not ready yet.") from exc
        attempt = PTGateAttempt(user_id=user_id, topic_id=topic.id, started_at=now, correct_count=0)
        session.add(attempt)
        await session.flush()
        for position, item in enumerate(drawn, start=1):
            session.add(PTGateAnswer(attempt_id=attempt.id, item_id=item.id, position=position))
        await session.commit()
        return await self._attempt_out(session, content, progress, attempt)

    async def _owned_attempt(self, session: AsyncSession, user_id: int, attempt_id: int) -> PTGateAttempt:
        attempt = (
            await session.execute(
                select(PTGateAttempt).where(PTGateAttempt.id == attempt_id, PTGateAttempt.user_id == user_id)
            )
        ).scalar_one_or_none()
        if attempt is None:
            raise ResourceNotFoundException("Gate attempt")
        return attempt

    async def _answers(self, session: AsyncSession, attempt_id: int) -> list[tuple[PTGateAnswer, PTGateItem]]:
        rows = (
            await session.execute(
                select(PTGateAnswer, PTGateItem)
                .join(PTGateItem, PTGateItem.id == PTGateAnswer.item_id)
                .where(PTGateAnswer.attempt_id == attempt_id)
                .order_by(PTGateAnswer.position)
            )
        ).all()
        return [(answer, item) for answer, item in rows]

    async def _attempt_out(
        self, session: AsyncSession, content: _Content, progress: _Progress, attempt: PTGateAttempt
    ) -> PTGateAttemptOut:
        topic = content.topic_by_id[attempt.topic_id]
        _, _, options = await self._gate_pools(session, content, progress, topic)
        answers = await self._answers(session, attempt.id)
        items: list[PTGateItemOut] = []
        for answer, item in answers:
            picked = answer.picked_key is not None
            items.append(
                PTGateItemOut(
                    id=item.id,
                    position=answer.position,
                    difficulty=item.difficulty,
                    time_limit_s=rules.step_time_limit(item.difficulty, None),
                    picked_key=answer.picked_key,
                    correct=answer.correct,
                    right_pattern=self._right_pattern(item, content) if picked else None,
                    cue=item.cue if picked else None,
                    kojo_note=answer.kojo_note,
                    solved=answer.solved,
                    seconds=answer.seconds,
                )
            )
        # Every drawn item's answer must be pickable, even if content changed since.
        keys = {option.key for option in options}
        for _, item in answers:
            pattern = self._right_pattern(item, content)
            if pattern.key not in keys:
                options.append(pattern)
                keys.add(pattern.key)
        return PTGateAttemptOut(
            attempt_id=attempt.id,
            topic_slug=topic.slug,
            topic_title=topic.title,
            started_at=_aware(attempt.started_at),
            finished_at=_aware(attempt.finished_at),
            picks_made=sum(1 for answer, _ in answers if answer.picked_key is not None),
            correct_count=sum(1 for answer, _ in answers if answer.correct),
            need=rules.GATE_PASS_CORRECT,
            passed=attempt.passed,
            locked_until=_aware(attempt.locked_until),
            options=options,
            items=items,
        )

    async def get_attempt(self, session: AsyncSession, user_id: int, attempt_id: int) -> PTGateAttemptOut:
        attempt = await self._owned_attempt(session, user_id, attempt_id)
        content = await self._content(session)
        progress = await self._progress(session, user_id, content)
        return await self._attempt_out(session, content, progress, attempt)

    async def gate_item(self, session: AsyncSession, user_id: int, attempt_id: int, item_id: int) -> PTGateItem:
        """The item behind a gate problem (server-side only: the slug never leaves)."""
        await self._owned_attempt(session, user_id, attempt_id)
        row = next((item for answer, item in await self._answers(session, attempt_id) if item.id == item_id), None)
        if row is None:
            raise ResourceNotFoundException("Gate item")
        return row

    async def record_pick(
        self, session: AsyncSession, user_id: int, attempt_id: int, *, item_id: int, picked_key: str, reason: str
    ) -> tuple[PTGateAttemptOut, PTGateItem, PTPattern, PTPattern, bool]:
        """Stores the verdict (decided here, never by the model) and finishes the attempt
        on the last pick. Returns (attempt, item, picked pattern, right pattern, correct);
        the route asks Kojo for the note afterwards, outside this transaction."""
        now = _utcnow()
        attempt = await self._owned_attempt(session, user_id, attempt_id)
        content = await self._content(session)
        progress = await self._progress(session, user_id, content)
        answers = await self._answers(session, attempt_id)
        match = next(((answer, item) for answer, item in answers if item.id == item_id), None)
        if match is None:
            raise ResourceNotFoundException("Gate item")
        answer, item = match
        if answer.picked_key is not None:
            raise TrailConflict("You already picked a pattern for this problem.")
        options = (await self._attempt_out(session, content, progress, attempt)).options
        picked = next((option for option in options if option.key == picked_key), None)
        if picked is None:
            raise TrailConflict("Pick one of the patterns in the list.")
        right = self._right_pattern(item, content)
        correct = picked_key == right.key

        answer.picked_key = picked_key
        answer.correct = correct
        answer.reason_text = reason
        picks = [a for a, _ in answers]
        if all(a.picked_key is not None for a in picks):
            attempt.finished_at = now
            attempt.correct_count = sum(1 for a in picks if a.correct)
            attempt.passed = rules.gate_passed(attempt.correct_count)
            attempt.locked_until = None if attempt.passed else rules.gate_lock_until(now)
        else:
            attempt.correct_count = sum(1 for a in picks if a.correct)
        await session.commit()
        return await self._attempt_out(session, content, progress, attempt), item, picked, right, correct

    async def save_note(self, session: AsyncSession, attempt_id: int, item_id: int, note: str) -> None:
        answer = (
            await session.execute(
                select(PTGateAnswer).where(PTGateAnswer.attempt_id == attempt_id, PTGateAnswer.item_id == item_id)
            )
        ).scalar_one_or_none()
        if answer is not None:
            answer.kojo_note = note
            await session.commit()

    async def record_gate_solve(
        self, session: AsyncSession, user_id: int, attempt_id: int, *, item_id: int, accepted: bool, seconds: int
    ) -> PTGateSolveResponse:
        """Stored for the record; never blocks the gate. A miss or slow solve gets a redo."""
        now = _utcnow()
        await self._owned_attempt(session, user_id, attempt_id)
        content = await self._content(session)
        match = next(
            ((answer, item) for answer, item in await self._answers(session, attempt_id) if item.id == item_id), None
        )
        if match is None:
            raise ResourceNotFoundException("Gate item")
        answer, item = match
        if answer.picked_key is None:
            raise TrailConflict("Pick a pattern first.")
        limit = rules.step_time_limit(item.difficulty, None)
        solved = accepted and 0 <= seconds <= limit
        slow = solved and rules.is_slow(seconds, limit)
        answer.solved = solved
        answer.seconds = seconds
        redo: Optional[PTRedo] = None
        if not solved or slow:
            redo = await self._schedule_redo(
                session, user_id, item.problem_slug, limit, now,
                last_result="slow" if solved else "failed", gate_item_id=item.id,
            )
        await session.commit()
        return PTGateSolveResponse(
            item_id=item.id, solved=solved, slow=slow,
            redo=self._redo_out(redo, content, now) if redo else None,
        )
