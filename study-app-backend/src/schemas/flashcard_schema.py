from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class FlashcardCreate(BaseModel):
    front: str = Field(..., min_length=1)
    back: str = Field(..., min_length=1)
    source: str = Field(default="user_created", max_length=50)


class FlashcardGenerateRequest(BaseModel):
    source_type: str = Field(..., pattern="^(test|prompt)$")
    test_id: Optional[int] = None
    prompt: Optional[str] = None
    count: int = Field(default=10, ge=1, le=50)

    @model_validator(mode="after")
    def validate_source(self) -> "FlashcardGenerateRequest":
        if self.source_type == "test" and self.test_id is None:
            raise ValueError("test_id is required when source_type is test")
        if self.source_type == "prompt" and not self.prompt:
            raise ValueError("prompt is required when source_type is prompt")
        return self


class FlashcardAttemptCreate(BaseModel):
    correct: bool
    time_ms: Optional[int] = Field(default=None, ge=0)


class FlashcardResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_id: int
    front: str
    back: str
    source: Optional[str] = None
    difficulty: int
    created_at: datetime
    updated_at: datetime
    attempt_count: int = 0
    correct_count: int = 0
    success_rate: Optional[float] = None
    last_attempted: Optional[datetime] = None
