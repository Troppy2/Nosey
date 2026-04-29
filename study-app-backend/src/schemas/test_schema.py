from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class MCQOptionPublic(BaseModel):
    id: int
    text: str
    is_correct: None = None


class QuestionPublic(BaseModel):
    id: int
    type: str
    question_text: str
    options: list[MCQOptionPublic] = Field(default_factory=list)


class TestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_id: int
    title: str
    description: Optional[str] = None
    test_type: str
    created_at: datetime
    updated_at: datetime


class TestSummary(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    test_type: str
    question_count: int = 0
    best_score: Optional[float] = None
    attempt_count: int = 0
    created_at: datetime


class TestUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None


class TestTakeResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    test_type: str
    questions: list[QuestionPublic]


class CreateTestResponse(BaseModel):
    test_id: int
    title: str
    questions_generated: int
    message: str = "Test created. Ready to take."


class WeaknessResponse(BaseModel):
    question_id: int
    question_text: str
    times_attempted: int
    times_correct: int
    success_rate: float
    category: str
