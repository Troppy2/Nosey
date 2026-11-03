from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.utils.time import UtcDatetime

# Quizlet import caps: one request holds at most this many cards, each side at
# most this long. The tidy pass reads at most TIDY_MAX_CHARS of pasted text so
# its JSON reply fits the default generation token budget.
IMPORT_MAX_CARDS = 1000
IMPORT_MAX_SIDE_CHARS = 5000
TIDY_MAX_CHARS = 12000


class FlashcardCreate(BaseModel):
    front: str = Field(..., min_length=1)
    back: str = Field(..., min_length=1)
    source: str = Field(default="user_created", max_length=50)
    topic: Optional[str] = Field(default=None, max_length=80)


class FlashcardGenerateRequest(BaseModel):
    source_type: str = Field(..., pattern="^(test|prompt)$")
    test_id: Optional[int] = None
    prompt: Optional[str] = None
    count: int = Field(default=10, ge=1, le=50)
    provider: Optional[str] = Field(default=None, description="Optional LLM provider override")
    enable_fallback: bool = Field(default=True)

    @model_validator(mode="after")
    def validate_source(self) -> "FlashcardGenerateRequest":
        if self.source_type == "test" and self.test_id is None:
            raise ValueError("test_id is required when source_type is test")
        if self.source_type == "prompt" and not self.prompt:
            raise ValueError("prompt is required when source_type is prompt")
        if self.provider is not None:
            provider = self.provider.strip().lower()
            provider_aliases = {
                "google": "gemini",
                "anthropic": "claude",
            }
            provider = provider_aliases.get(provider, provider)
            if provider not in ("auto", "groq", "gemini", "claude", "ollama", "minimax"):
                raise ValueError("provider must be auto, groq, google, anthropic, gemini, claude, ollama, or minimax")
            self.provider = provider
        return self


class FlashcardUpdate(BaseModel):
    front: str = Field(..., min_length=1)
    back: str = Field(..., min_length=1)


class FlashcardImportItem(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    front: str = Field(..., min_length=1, max_length=IMPORT_MAX_SIDE_CHARS)
    back: str = Field(..., min_length=1, max_length=IMPORT_MAX_SIDE_CHARS)


class FlashcardBulkImportRequest(BaseModel):
    cards: list[FlashcardImportItem] = Field(..., min_length=1, max_length=IMPORT_MAX_CARDS)
    source: Literal["quizlet_import"] = "quizlet_import"


class FlashcardTidyRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=TIDY_MAX_CHARS)


class FlashcardTidyItem(BaseModel):
    front: str
    back: str
    # False when Kojo's pair can't be found word for word in the pasted text,
    # so the review step asks the student to check it.
    verbatim: bool


class FlashcardTidyResponse(BaseModel):
    cards: list[FlashcardTidyItem]


class FlashcardAttemptCreate(BaseModel):
    correct: Optional[bool] = None
    rating: Optional[Literal["hard", "medium", "easy"]] = None
    time_ms: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def resolve_rating_and_correct(self) -> "FlashcardAttemptCreate":
        if self.rating is not None:
            self.correct = (self.rating != "hard")
        elif self.correct is not None:
            self.rating = "medium" if self.correct else "hard"
        else:
            raise ValueError("Either rating or correct must be provided.")
        return self


class FlashcardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_id: int
    front: str
    back: str
    source: Optional[str] = None
    topic: Optional[str] = None
    difficulty: int
    ease: float = 2.5
    interval_days: int = 0
    reps: int = 0
    lapses: int = 0
    due_at: Optional[UtcDatetime] = None
    last_reviewed_at: Optional[UtcDatetime] = None
    is_due: bool = False
    is_new: bool = True
    created_at: datetime
    updated_at: datetime
    attempt_count: int = 0
    correct_count: int = 0
    success_rate: Optional[float] = None
    last_attempted: Optional[datetime] = None

    @model_validator(mode="after")
    def compute_due_and_new(self) -> "FlashcardResponse":
        if self.due_at is None:
            self.is_new = True
            self.is_due = False
        else:
            self.is_new = False
            now = datetime.now(timezone.utc) if self.due_at.tzinfo else datetime.utcnow()
            self.is_due = self.due_at <= now
        return self


class DueSummaryFolder(BaseModel):
    folder_id: int
    name: str
    due: int


class DueSummaryCard(BaseModel):
    id: int
    folder_id: int
    folder_name: str
    front: str
    difficulty: int
    due_at: Optional[UtcDatetime] = None
    lapses: int = 0


class FlashcardDueSummaryResponse(BaseModel):
    total_due: int
    folders: list[DueSummaryFolder]
    cards: list[DueSummaryCard]
