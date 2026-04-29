from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    subject: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    subject: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None


class FolderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    subject: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    test_count: int = 0
    flashcard_count: int = 0
