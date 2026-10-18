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
from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.flashcard import Flashcard, FlashcardAttempt
from src.models.question import Question
from src.models.test import Test
from src.models.user_answer import UserAnswer
from src.models.user_attempt import UserAttempt
from src.repositories.folder_repository import FolderRepository
from src.schemas.attempt_schema import OCR_STATUS_NEEDS_INPUT
from src.schemas.folder_stats_schema import (
    Encouragement,
    FolderStatsResponse,
    MissedTopic,
    ScorePoint,
    TopicStat,
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


class FolderStatsService:
    async def get_stats(self, folder_id: int, user_id: int, session: AsyncSession) -> FolderStatsResponse:
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

        answer_rows = (await session.execute(
            select(Question.topic, UserAnswer.is_correct, UserAttempt.created_at)
            .join(UserAnswer, UserAnswer.question_id == Question.id)
            .join(UserAttempt, UserAttempt.id == UserAnswer.attempt_id)
            .join(Test, Test.id == Question.test_id)
            .where(
                Test.folder_id == folder_id,
                UserAttempt.user_id == user_id,
                UserAttempt.status == "submitted",
                Question.topic.is_not(None),
                or_(UserAnswer.ocr_status.is_(None), UserAnswer.ocr_status != OCR_STATUS_NEEDS_INPUT),
            )
        )).all()
        card_rows = (await session.execute(
            select(Flashcard.topic, FlashcardAttempt.correct, FlashcardAttempt.created_at)
            .join(FlashcardAttempt, FlashcardAttempt.flashcard_id == Flashcard.id)
            .where(
                Flashcard.folder_id == folder_id,
                FlashcardAttempt.user_id == user_id,
                Flashcard.topic.is_not(None),
            )
        )).all()
        marks = [_Mark(r.topic, bool(r.is_correct), r.created_at, True) for r in answer_rows]
        marks += [_Mark(r.topic, bool(r.correct), r.created_at, False) for r in card_rows]

        return FolderStatsResponse(
            folder_id=folder_id,
            tests_taken=len(progression),
            average_score=round(sum(scores) / len(scores), 1) if scores else None,
            best_score=max(scores) if scores else None,
            latest_score=scores[-1] if scores else None,
            score_progression=progression,
            topics=summarize_topics(marks),
            encouragement=encouragement_for(scores),
        )
