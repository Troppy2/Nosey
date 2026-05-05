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


# New question type schemas for beta features

class MatchingPair(BaseModel):
    """One term-definition or left-right pair for matching questions."""
    left: str
    right: str


class MatchingPairInput(BaseModel):
    left: str = Field(min_length=1)
    right: str = Field(min_length=1)


class SelectAllOption(BaseModel):
    """Option for select-all question (like MCQ but multiple correct answers)."""
    id: int
    text: str
    is_correct: None = None  # Hidden from student


class SelectAllOptionEditable(BaseModel):
    id: int
    text: str
    is_correct: bool


class SelectAllOptionInput(BaseModel):
    text: str
    is_correct: bool


class QuestionPublic(BaseModel):
    id: int
    type: str
    question_text: str
    
    # MCQ/select_all fields
    options: list[MCQOptionPublic] = Field(default_factory=list)
    
    # Matching fields
    matching_pairs: list[MatchingPair] = Field(default_factory=list)
    
    # Ordering fields
    ordering_items: list[str] = Field(default_factory=list)
    
    # Fill-in-the-blank: no extra fields (just question_text + text input)


class QuestionEditable(BaseModel):
    id: int
    type: str
    question_text: str
    
    # MCQ/select_all fields
    options: list[MCQOptionEditable] = Field(default_factory=list)
    
    # Matching fields
    matching_pairs: list[MatchingPair] = Field(default_factory=list)
    
    # Ordering fields
    ordering_items: list[str] = Field(default_factory=list)
    
    # FRQ/fill_blank expected answer
    expected_answer: Optional[str] = None


class QuestionCreate(BaseModel):
    type: str
    question_text: str = Field(min_length=1)
    
    # MCQ/select_all fields
    options: list[MCQOptionInput] = Field(default_factory=list)
    
    # Matching fields
    matching_pairs: list[MatchingPairInput] = Field(default_factory=list)
    
    # Ordering fields
    ordering_items: list[str] = Field(default_factory=list)
    
    # FRQ/fill_blank expected answer
    expected_answer: Optional[str] = None


class QuestionUpdate(BaseModel):
    question_text: Optional[str] = Field(default=None, min_length=1)
    
    # MCQ/select_all fields
    options: Optional[list[MCQOptionInput]] = None
    
    # Matching fields
    matching_pairs: Optional[list[MatchingPairInput]] = None
    
    # Ordering fields
    ordering_items: Optional[list[str]] = None
    
    # FRQ/fill_blank expected answer
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


class TestUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None


class TestTakeResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    test_type: str
    is_math_mode: bool = False
    is_coding_mode: bool = False
    coding_language: Optional[str] = None
    questions: list[QuestionPublic]


class CreateTestResponse(BaseModel):
    test_id: int
    title: str
    questions_generated: int
    message: str = "Test created. Ready to take."
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
