from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

TopicStatus = Literal["weak", "strong", "neutral", "new"]
Encouragement = Literal["empty", "first", "improving", "dipping", "steady"]


class ScorePoint(BaseModel):
    attempt_id: int
    test_id: int
    test_title: str
    score: float
    created_at: datetime


class TopicStat(BaseModel):
    topic: str
    # Accuracy over the most recent answers (see ROLLING_WINDOW), 0 to 1.
    accuracy: float
    answers: int
    test_answers: int
    flashcard_answers: int
    status: TopicStatus
    last_seen: datetime


class TodayQuiz(BaseModel):
    test_id: int
    generation_status: str
    # The student finished at least one attempt of today's quiz.
    completed: bool


class FolderStatsResponse(BaseModel):
    folder_id: int
    tests_taken: int
    average_score: float | None = None
    best_score: float | None = None
    latest_score: float | None = None
    score_progression: list[ScorePoint]
    topics: list[TopicStat]
    encouragement: Encouragement
    # Today's daily quiz (user's local day), or None when not made yet.
    today_quiz: TodayQuiz | None = None


class DailyQuizRequest(BaseModel):
    # JavaScript Date.getTimezoneOffset(): minutes to add to local time for UTC.
    tz_offset_minutes: int = Field(default=0, ge=-840, le=840)


class DailyQuizResponse(BaseModel):
    test_id: int
    generation_status: str
    # False when today's quiz already existed and was returned as is.
    created: bool


class MissedTopic(BaseModel):
    topic: str
    missed: int
    total: int
