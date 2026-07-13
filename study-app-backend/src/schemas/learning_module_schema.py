from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CreateLearningTrackRequest(BaseModel):
    module_count: int = Field(default=5, ge=1, le=20)
    provider: Optional[str] = None
    # Generous ceiling as an abuse/token-cost guard; the UI does not surface it.
    custom_instructions: Optional[str] = Field(default=None, max_length=10000)


class QuizQuestionPublic(BaseModel):
    """A quiz question as sent to the client: no correct_index (graded server-side)."""

    question: str
    options: list[str]


class LearningModuleResponse(BaseModel):
    id: int
    order_index: int
    title: str
    summary: Optional[str] = None
    lesson_content: Optional[str] = None
    # Spoken-word script for TTS; null on modules generated before it existed.
    tts_script: Optional[str] = None
    quiz: Optional[list[QuizQuestionPublic]] = None
    best_score: Optional[int] = None
    passed: bool
    # True once both the lesson and quiz have been generated.
    ready: bool


class LearningTrackResponse(BaseModel):
    id: int
    folder_id: int
    status: str
    error: Optional[str] = None
    module_count: int
    # Echoed back so the UI can show them and a rebuild can reuse them.
    custom_instructions: Optional[str] = None
    # True when the folder's current notes no longer match the notes this track
    # was built from; the UI offers a rebuild.
    notes_stale: bool
    modules: list[LearningModuleResponse]


class QuizAttemptRequest(BaseModel):
    # Selected option index per question, in question order. -1 = unanswered.
    answers: list[int]


class QuizAttemptResponse(BaseModel):
    score: int
    total: int
    passed: bool
    # 0-based correct option index per question, revealed after grading.
    correct_indices: list[int]
    best_score: int
