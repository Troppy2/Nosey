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
    is_coding_mode: bool = False
    coding_language: Optional[str] = None
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
    generation_status: str = "ready"
    generation_error: Optional[str] = None


class RegenerateTestRequest(BaseModel):
    """Parameters to re-run generation for an existing test, reusing its stored notes.

    The notes themselves are NOT re-uploaded: they are read from the test's persisted
    Note rows. These fields mirror the create-test generation knobs (which live in the
    frontend's localStorage), so a retry reproduces the original request.
    """

    count_mcq: int = Field(default=10, ge=0, le=50)
    count_frq: int = Field(default=5, ge=0, le=50)
    count_tf: int = Field(default=0, ge=0, le=10)
    count_ms: int = Field(default=0, ge=0, le=10)
    count_rank: int = Field(default=0, ge=0, le=10)
    difficulty: str = "mixed"
    topic_focus: Optional[str] = None
    custom_instructions: Optional[str] = None
    provider: Optional[str] = None
    enable_fallback: bool = True


class TestUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None


class TestTakeResponse(BaseModel):
    id: int
    folder_id: int
    folder_name: str
    title: str
    description: Optional[str] = None
    test_type: str
    is_math_mode: bool = False
    is_coding_mode: bool = False
    coding_language: Optional[str] = None
    questions: list[QuestionPublic]
    # Streaming generation: lets the take-test screen render questions as they arrive
    # and keep polling until generation finishes.
    generation_status: str = "ready"
    generation_error: Optional[str] = None
    expected_question_count: Optional[int] = None


class CreateTestResponse(BaseModel):
    test_id: int
    title: str
    questions_generated: int = 0
    message: str = "Test created. Ready to take."
    generation_status: str = "ready"
    fallback_used: bool = False
    fallback_reason: Optional[str] = None
    note_grounded: bool = True
    retrieval_enabled: bool = False
    retrieval_total_chunks: int = 0
    retrieval_selected_chunks: int = 0
    retrieval_top_k: int = 0


class WeaknessResponse(BaseModel):
    question_id: int
    question_text: str
    times_attempted: int
    times_correct: int
    success_rate: float
    category: str
