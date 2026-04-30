from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class MCQOptionPublic(BaseModel):
    id: int
    text: str
    is_correct: None = None


class MCQOptionEditable(BaseModel):
    id: int
    text: str
    is_correct: bool


class MCQOptionInput(BaseModel):
    text: str
    is_correct: bool


class QuestionPublic(BaseModel):
    id: int
    type: str
    question_text: str
    options: list[MCQOptionPublic] = Field(default_factory=list)


class QuestionEditable(BaseModel):
    id: int
    type: str
    question_text: str
    options: list[MCQOptionEditable] = Field(default_factory=list)
    expected_answer: Optional[str] = None


class QuestionCreate(BaseModel):
    type: str
    question_text: str = Field(min_length=1)
    options: list[MCQOptionInput] = Field(default_factory=list)
    expected_answer: Optional[str] = None


class QuestionUpdate(BaseModel):
    question_text: Optional[str] = Field(default=None, min_length=1)
    options: Optional[list[MCQOptionInput]] = None
    expected_answer: Optional[str] = None


class TestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_id: int
    title: str
    description: Optional[str] = None
    test_type: str
    is_math_mode: bool = False
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
    is_math_mode: bool = False
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
