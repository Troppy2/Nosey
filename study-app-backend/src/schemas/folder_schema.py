from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, PositiveInt, field_validator


class FolderSelection(BaseModel):
    folder_ids: list[PositiveInt] = Field(min_length=1, max_length=1000)

    @field_validator("folder_ids")
    @classmethod
    def unique_ids(cls, ids: list[int]) -> list[int]:
        if len(ids) != len(set(ids)):
            raise ValueError("Folder ids must be unique.")
        return ids


class FolderBulkAction(FolderSelection):
    action: Literal["archive", "delete"]


class FolderBulkResult(BaseModel):
    affected: int


class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    subject: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    subject: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    kojo_sync_default: Optional[bool] = None
    kojo_allow_artifacts: Optional[bool] = None
    kojo_auto_index: Optional[bool] = None
    kojo_persona: Optional[str] = Field(default=None, max_length=32)
    is_archived: Optional[bool] = None
    avoid_repeat_questions: Optional[bool] = None
    default_view: Optional[Literal["stats", "flashcards"]] = None
    # "" clears it. Same cap as Create Test's custom instructions.
    test_instructions: Optional[str] = Field(default=None, max_length=10_000)


class FolderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    subject: Optional[str] = None
    description: Optional[str] = None
    kojo_sync_default: bool = True
    kojo_allow_artifacts: bool = True
    kojo_auto_index: bool = True
    kojo_persona: Optional[str] = None
    is_archived: bool = False
    avoid_repeat_questions: bool = False
    default_view: str = "stats"
    test_instructions: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    test_count: int = 0
    flashcard_count: int = 0
