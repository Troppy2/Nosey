from __future__ import annotations

import base64
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# Decoded-byte guards for a scratch-pad drawing (STEM Scratch Pad feature).
# max_length on `work_image` below is a CHARACTER count on the base64 string,
# which is ~33% larger than the decoded PNG; the real, authoritative byte cap
# is enforced separately on the decoded bytes in SubmitAttemptRequest below.
_WORK_IMAGE_MAX_B64_CHARS = 2_500_000  # ~1.9MB decoded, comfortably under Claude's 10MB cap
_WORK_IMAGE_MAX_DECODED_BYTES = 1_500_000
_WORK_IMAGE_MAX_COUNT = 6
_WORK_IMAGE_TOTAL_DECODED_BUDGET = 4_000_000
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class SubmittedAnswer(BaseModel):
    # No longer required to be non-empty on its own: a drawing-only answer
    # (work_image set, answer left blank) is legal. At least one of the two
    # must be present; enforced by the model_validator below rather than a
    # field constraint, since the rule spans two fields.
    question_id: int
    answer: str = Field(default="", max_length=5000)
    # Base64-encoded PNG of the scratch-pad drawing (STEM Scratch Pad
    # feature). Optional, beta-gated at the route. Never persisted: graded via
    # OcrService then discarded (see .claude/design-patterns/ocr-routing.md).
    work_image: Optional[str] = Field(default=None, max_length=_WORK_IMAGE_MAX_B64_CHARS)

    @field_validator("answer")
    @classmethod
    def strip_answer(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_answer_or_work(self) -> "SubmittedAnswer":
        if not self.answer and not self.work_image:
            raise ValueError("Provide a typed answer, a drawing, or both")
        return self


class SubmitAttemptRequest(BaseModel):
    answers: list[SubmittedAnswer] = Field(..., min_length=1)
    # Which OCR engine to transcribe scratch-pad drawings with. Resolved and
    # validated server-side via resolve_ocr_engine (STEM Scratch Pad feature);
    # non-beta users cannot override it regardless of what is sent here.
    ocr_engine: Optional[str] = None

    @model_validator(mode="after")
    def validate_work_images(self) -> "SubmitAttemptRequest":
        images = [a.work_image for a in self.answers if a.work_image]
        if len(images) > _WORK_IMAGE_MAX_COUNT:
            raise ValueError(
                f"At most {_WORK_IMAGE_MAX_COUNT} scratch-pad drawings can be submitted at once"
            )
        total_decoded = 0
        for image_b64 in images:
            try:
                decoded = base64.b64decode(image_b64, validate=True)
            except Exception as exc:
                raise ValueError("A scratch-pad drawing was not valid base64") from exc
            if len(decoded) > _WORK_IMAGE_MAX_DECODED_BYTES:
                raise ValueError("A scratch-pad drawing is too large")
            if not decoded.startswith(_PNG_MAGIC):
                raise ValueError("Scratch-pad drawings must be PNG images")
            total_decoded += len(decoded)
        if total_decoded > _WORK_IMAGE_TOTAL_DECODED_BUDGET:
            raise ValueError("Scratch-pad drawings are too large in total")
        return self


class AnswerResult(BaseModel):
    question_id: int
    question_text: Optional[str] = None
    user_answer: str
    correct_answer: Optional[str] = None
    is_correct: bool
    feedback: Optional[str] = None
    reasoning: Optional[str] = None
    confidence: Optional[float] = None
    flagged_uncertain: bool = False
    is_math: bool = False
    # What the OCR engine read from a scratch-pad drawing, if one was
    # submitted (STEM Scratch Pad feature). Response-only: never persisted to
    # UserAnswer, so it is absent when this question is viewed again later via
    # AttemptDetail. Shown to the student so an OCR misread is diagnosable
    # rather than reading as an inexplicable grade.
    work_transcript: Optional[str] = None


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
    reasoning: Optional[str] = None
    flagged_uncertain: bool = False
    confidence: float = 0.0
    # Echoed back so the route can put it on AnswerResult.work_transcript
    # without re-fetching. Not a DB column; grade_math_answer sets this only
    # when it was passed a work: OcrResult (STEM Scratch Pad feature).
    work_transcript: Optional[str] = None


# Confidence floor below which a transcript is context-only in grading and
# must not affect the correctness verdict. Lives here, not in ocr_service.py
# or llm_service.py, so both can import it without a circular dependency
# (ocr_service imports LLMService; llm_service must not import ocr_service).
OCR_LOW_CONFIDENCE_THRESHOLD = 0.4


class OcrResult(BaseModel):
    """What one OCR engine read from a scratch-pad drawing.

    See .claude/design-patterns/ocr-routing.md. Every engine returns this same
    shape so the engine choice affects only transcription fidelity, never
    grading policy: grading always runs its own prompt through its own
    provider chain regardless of which engine produced the transcript.
    """

    transcript: str
    # Free-text spatial description (layout, crossed-out work, boxed answers)
    # a plain LaTeX transcript would lose. Claude fills this in the same
    # vision call; an engine with no layout awareness returns None and the
    # grading prompt simply omits that section.
    layout_notes: Optional[str] = None
    # Required, not optional. Below a floor (checked in grade_math_answer),
    # the transcript is used as context only and must never flip is_correct
    # to false: an OCR misread must never read as "the student was wrong."
    confidence: float
    engine: str


class DraftAttemptAnswer(BaseModel):
    """A draft answer saved while test is in progress."""
    question_id: int
    user_answer: str = Field(..., min_length=0, max_length=5000)  # Allow empty for drafts
    # Scratch-pad strokes captured so far, as opaque JSON (the frontend's
    # stroke format), so a drawing resumes across devices the same way a
    # typed answer does. Cleared implicitly when the draft is deleted at
    # submit time (GradingService.submit_and_grade); never present on a
    # graded UserAnswer.
    work_strokes: Optional[str] = Field(default=None, max_length=200_000)


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


class ReviewSummaryResponse(BaseModel):
    summary: str
