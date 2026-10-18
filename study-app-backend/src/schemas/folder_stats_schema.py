from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

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


class FolderStatsResponse(BaseModel):
    folder_id: int
    tests_taken: int
    average_score: float | None = None
    best_score: float | None = None
    latest_score: float | None = None
    score_progression: list[ScorePoint]
    topics: list[TopicStat]
    encouragement: Encouragement


class MissedTopic(BaseModel):
    topic: str
    missed: int
    total: int
