from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class SubmittedAnswer(BaseModel):
    question_id: int
    answer: str = Field(..., min_length=1, max_length=5000)

    @field_validator("answer")
    @classmethod
    def strip_answer(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Answer cannot be empty")
        return stripped


class SubmitAttemptRequest(BaseModel):
    answers: list[SubmittedAnswer] = Field(..., min_length=1)


class AnswerResult(BaseModel):
    question_id: int
    user_answer: str
    is_correct: bool
    feedback: Optional[str] = None
    confidence: Optional[float] = None
    flagged_uncertain: bool = False


class AttemptResult(BaseModel):
    attempt_id: int
    attempt_number: int
    score: float
    correct_count: int
    total: int
    answers: list[AnswerResult]


class AttemptSummary(BaseModel):
    id: int
    attempt_number: int
    score: float
    correct_count: int
    total: int
    created_at: datetime


class AttemptDetail(AttemptSummary):
    answers: list[AnswerResult]


class FRQGrade(BaseModel):
    is_correct: bool
    feedback: Optional[str] = None
    flagged_uncertain: bool = False
    confidence: float = 0.0
