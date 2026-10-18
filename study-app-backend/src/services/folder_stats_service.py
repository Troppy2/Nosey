"""Per-folder progress stats: test score history and weak / strong topics.

Everything is derived from rows that already exist, no event table:
graded test answers (user_answers joined to questions.topic) and flashcard
review marks (flashcard_attempts joined to flashcards.topic). Untagged
content (topic NULL, migration 071) is left out of the topic list but its
tests still count toward tests_taken and the score history.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.flashcard import Flashcard, FlashcardAttempt
from src.models.folder import Folder
from src.models.question import Question
from src.models.test import Test
from src.models.user_answer import UserAnswer
from src.models.user_attempt import UserAttempt
from src.repositories.folder_repository import FolderRepository
from src.utils.time import utcnow_naive
from src.schemas.attempt_schema import OCR_STATUS_NEEDS_INPUT
from src.schemas.folder_stats_schema import (
    Encouragement,
    FolderStatsResponse,
    MissedTopic,
    ScorePoint,
    TodayQuiz,
    TopicStat,
    WeakSpot,
    TopicStatus,
)
from src.utils.exceptions import ResourceNotFoundException

# Weak / strong is judged on a topic's most recent answers so improvement
# shows quickly. Fewer than MIN_ANSWERS answers is too little to judge.
ROLLING_WINDOW = 20
MIN_ANSWERS = 3
WEAK_BELOW = 0.60
STRONG_FROM = 0.80
# A latest score this many points above / below the recent average.
TREND_POINTS = 5.0
TREND_LOOKBACK = 3
# Daily quiz: 10 questions, about 70% on weak topics and 30% on strong ones.
DAILY_QUIZ_KIND = "daily"
DAILY_MCQ = 8
DAILY_FRQ = 2
DAILY_WEAK_SHARE = 7
DAILY_TOPICS_PER_SIDE = 4


@dataclass(frozen=True)
class _Mark:
    topic: str
    correct: bool
    at: datetime
    from_test: bool


def classify(accuracy: float, answers: int) -> TopicStatus:
    if answers < MIN_ANSWERS:
        return "new"
    if accuracy < WEAK_BELOW:
        return "weak"
    if accuracy >= STRONG_FROM:
        return "strong"
    return "neutral"


def summarize_topics(marks: Iterable[_Mark]) -> list[TopicStat]:
    """Group marks by topic (case-insensitive), weakest first."""
    groups: dict[str, list[_Mark]] = defaultdict(list)
    for mark in marks:
        groups[mark.topic.lower()].append(mark)
    stats: list[TopicStat] = []
    for group in groups.values():
        group.sort(key=lambda m: m.at, reverse=True)
        recent = group[:ROLLING_WINDOW]
        accuracy = sum(m.correct for m in recent) / len(recent)
        name = Counter(m.topic for m in group).most_common(1)[0][0]
        stats.append(TopicStat(
            topic=name,
            accuracy=round(accuracy, 3),
            answers=len(group),
            test_answers=sum(m.from_test for m in group),
            flashcard_answers=sum(not m.from_test for m in group),
            status=classify(accuracy, len(group)),
            last_seen=group[0].at,
        ))
    stats.sort(key=lambda s: (s.status == "new", s.accuracy, -s.answers))
    return stats


def encouragement_for(scores: list[float]) -> Encouragement:
    if not scores:
        return "empty"
    if len(scores) == 1:
        return "first"
    previous = scores[-1 - TREND_LOOKBACK:-1]
    baseline = sum(previous) / len(previous)
    if scores[-1] >= baseline + TREND_POINTS:
        return "improving"
    if scores[-1] <= baseline - TREND_POINTS:
        return "dipping"
    return "steady"


def missed_topics(rows: Iterable[tuple[Optional[str], bool]]) -> list[MissedTopic]:
    """(topic, is_correct) per answer -> topics with at least one miss, most missed first."""
    totals: dict[str, list[int]] = {}
    names: dict[str, str] = {}
    for topic, is_correct in rows:
        if not topic:
            continue
        key = topic.lower()
        names.setdefault(key, topic)
        entry = totals.setdefault(key, [0, 0])
        entry[1] += 1
        if not is_correct:
            entry[0] += 1
    out = [MissedTopic(topic=names[k], missed=m, total=t) for k, (m, t) in totals.items() if m]
    out.sort(key=lambda x: (-x.missed, -(x.missed / x.total), x.topic.lower()))
    return out


def local_day_window(tz_offset_minutes: int, now: Optional[datetime] = None) -> tuple[datetime, datetime]:
    """[start, end) of the user's local calendar day, as naive UTC (how rows are stored)."""
    now = now or utcnow_naive()
    offset = timedelta(minutes=tz_offset_minutes)
    local_now = now - offset
    local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = local_start + offset
    return start, start + timedelta(days=1)


@dataclass(frozen=True)
class DailyQuizPlan:
    focus: list[str]
    review: list[str]

    def instructions(self) -> str:
        """Custom instructions for the generator: which topics, in what proportion."""
        review_count = 10 - DAILY_WEAK_SHARE if self.review else 0
        focus_count = 10 - review_count
        lines = [
            "This is the student's daily practice quiz. It targets the topics they find hardest.",
            f"- About {focus_count} of the 10 questions must cover these topics: {'; '.join(self.focus)}.",
        ]
        if self.review:
            lines.append(
                f"- The other {review_count} questions are a quick review of topics they already know: "
                f"{'; '.join(self.review)}."
            )
        lines.append("- Use each topic name above exactly as written for the question's topic tag.")
        return "\n".join(lines)


def plan_daily_quiz(topics: list[TopicStat]) -> Optional[DailyQuizPlan]:
    """Weak topics first (lowest accuracy), topped up with the next weakest; strong ones for review.

    None when the folder has no topic data yet.
    """
    if not topics:
        return None
    weak = sorted((t for t in topics if t.status == "weak"), key=lambda t: t.accuracy)
    rest = sorted((t for t in topics if t.status in ("neutral", "new")), key=lambda t: t.accuracy)
    strong = sorted((t for t in topics if t.status == "strong"), key=lambda t: t.accuracy)
    focus = (weak + rest)[:DAILY_TOPICS_PER_SIDE]
    if not focus:
        # Everything is strong: practice the least strong ones.
        focus, strong = strong[:DAILY_TOPICS_PER_SIDE], strong[DAILY_TOPICS_PER_SIDE:]
    review = [t for t in strong if t not in focus][:DAILY_TOPICS_PER_SIDE]
    return DailyQuizPlan(focus=[t.topic for t in focus], review=[t.topic for t in review])


async def todays_quiz(
    session: AsyncSession, folder_id: int, user_id: int, tz_offset_minutes: int
) -> Optional[TodayQuiz]:
    """The newest daily quiz made today in the user's local day, skipping failed ones."""
    start, end = local_day_window(tz_offset_minutes)
    test = await session.scalar(
        select(Test)
        .where(
            Test.folder_id == folder_id,
            Test.kind == DAILY_QUIZ_KIND,
            Test.generation_status != "failed",
            Test.created_at >= start,
            Test.created_at < end,
        )
        .order_by(Test.created_at.desc())
        .limit(1)
    )
    if test is None:
        return None
    completed = await session.scalar(
        select(UserAttempt.id).where(
            UserAttempt.test_id == test.id,
            UserAttempt.user_id == user_id,
            UserAttempt.status == "submitted",
        ).limit(1)
    )
    return TodayQuiz(test_id=test.id, generation_status=test.generation_status, completed=completed is not None)


async def _load_marks(
    session: AsyncSession, user_id: int, folder_ids: list[int]
) -> list[tuple[int, _Mark]]:
    """(folder_id, mark) for every tagged test answer and flashcard review in these folders."""
    if not folder_ids:
        return []
    answer_rows = (await session.execute(
        select(Test.folder_id, Question.topic, UserAnswer.is_correct, UserAttempt.created_at)
        .join(UserAnswer, UserAnswer.question_id == Question.id)
        .join(UserAttempt, UserAttempt.id == UserAnswer.attempt_id)
        .join(Test, Test.id == Question.test_id)
        .where(
            Test.folder_id.in_(folder_ids),
            UserAttempt.user_id == user_id,
            UserAttempt.status == "submitted",
            Question.topic.is_not(None),
            or_(UserAnswer.ocr_status.is_(None), UserAnswer.ocr_status != OCR_STATUS_NEEDS_INPUT),
        )
    )).all()
    card_rows = (await session.execute(
        select(Flashcard.folder_id, Flashcard.topic, FlashcardAttempt.correct, FlashcardAttempt.created_at)
        .join(FlashcardAttempt, FlashcardAttempt.flashcard_id == Flashcard.id)
        .where(
            Flashcard.folder_id.in_(folder_ids),
            FlashcardAttempt.user_id == user_id,
            Flashcard.topic.is_not(None),
        )
    )).all()
    out = [(r.folder_id, _Mark(r.topic, bool(r.is_correct), r.created_at, True)) for r in answer_rows]
    out += [(r.folder_id, _Mark(r.topic, bool(r.correct), r.created_at, False)) for r in card_rows]
    return out


# Dashboard Weak Spots: how many topics to show across all folders.
WEAK_SPOTS_LIMIT = 5


class FolderStatsService:
    async def weak_spots(self, user_id: int, session: AsyncSession) -> list[WeakSpot]:
        """Weakest topics across the user's active folders, weakest first (Dashboard)."""
        folders = (await session.execute(
            select(Folder.id, Folder.name).where(Folder.user_id == user_id, Folder.is_archived.is_(False))
        )).all()
        names = {row.id: row.name for row in folders}
        by_folder: dict[int, list[_Mark]] = defaultdict(list)
        for folder_id, mark in await _load_marks(session, user_id, list(names)):
            by_folder[folder_id].append(mark)
        spots = [
            WeakSpot(folder_id=folder_id, folder_name=names[folder_id], **topic.model_dump())
            for folder_id, marks in by_folder.items()
            for topic in summarize_topics(marks)
            if topic.status == "weak"
        ]
        spots.sort(key=lambda s: (s.accuracy, -s.answers))
        return spots[:WEAK_SPOTS_LIMIT]

    async def get_stats(
        self, folder_id: int, user_id: int, session: AsyncSession, tz_offset_minutes: int = 0
    ) -> FolderStatsResponse:
        if await FolderRepository(session).get_owned(folder_id, user_id) is None:
            raise ResourceNotFoundException("Folder")

        attempt_rows = (await session.execute(
            select(UserAttempt.id, UserAttempt.test_id, Test.title, UserAttempt.total_score, UserAttempt.created_at)
            .join(Test, Test.id == UserAttempt.test_id)
            .where(
                Test.folder_id == folder_id,
                UserAttempt.user_id == user_id,
                UserAttempt.status == "submitted",
            )
            .order_by(UserAttempt.created_at)
        )).all()
        progression = [
            ScorePoint(
                attempt_id=row.id, test_id=row.test_id, test_title=row.title,
                score=float(row.total_score or 0), created_at=row.created_at,
            )
            for row in attempt_rows
        ]
        scores = [p.score for p in progression]

        marks = [mark for _, mark in await _load_marks(session, user_id, [folder_id])]

        return FolderStatsResponse(
            folder_id=folder_id,
            tests_taken=len(progression),
            average_score=round(sum(scores) / len(scores), 1) if scores else None,
            best_score=max(scores) if scores else None,
            latest_score=scores[-1] if scores else None,
            score_progression=progression,
            topics=summarize_topics(marks),
            encouragement=encouragement_for(scores),
            today_quiz=await todays_quiz(session, folder_id, user_id, tz_offset_minutes),
        )
