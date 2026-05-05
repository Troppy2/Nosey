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
    question_text: Optional[str] = None
    user_answer: str
    correct_answer: Optional[str] = None
    is_correct: bool
    feedback: Optional[str] = None
    confidence: Optional[float] = None
    flagged_uncertain: bool = False
    is_math: bool = False


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
    test_id: int
    folder_id: Optional[int] = None
    test_title: str = ""
    answers: list[AnswerResult]


class FRQGrade(BaseModel):
    is_correct: bool
    feedback: Optional[str] = None
    flagged_uncertain: bool = False
    confidence: float = 0.0


class DraftAttemptAnswer(BaseModel):
    """A draft answer saved while test is in progress."""
    question_id: int
    user_answer: str = Field(..., min_length=0, max_length=5000)  # Allow empty for drafts


class SaveDraftAttemptRequest(BaseModel):
    """Save current progress on a test."""
    answers: list[DraftAttemptAnswer] = Field(..., min_length=0)


class ResumableTestInfo(BaseModel):
    """Info about a test that can be resumed."""
    test_id: int
    test_title: str
    attempt_id: int
    attempt_number: int
    exited_at: datetime
    answered_question_count: int
    total_question_count: int


class DraftAttemptResponse(BaseModel):
    """Response when loading a draft attempt for resuming."""
    attempt_id: int
    attempt_number: int
    answers: list[DraftAttemptAnswer]
    exited_at: Optional[datetime] = None
