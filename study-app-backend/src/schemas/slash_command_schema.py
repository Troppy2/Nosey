from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


def normalize_slash(value: str) -> str:
    slash = value.strip().lower()
    if slash and not slash.startswith("/"):
        slash = f"/{slash}"
    return slash


class SlashCommandCreate(BaseModel):
    slash: str = Field(..., min_length=2, max_length=64, pattern=r"^/?[a-z0-9][a-z0-9-]*$")
    label: str = Field(..., min_length=1, max_length=120)
    description: str = Field(..., min_length=1, max_length=255)
    prompt: str = Field(..., min_length=1, max_length=5000)
    is_pinned: bool = False
    position: int = Field(default=0, ge=0)

    @field_validator("slash")
    @classmethod
    def normalize_command(cls, value: str) -> str:
        return normalize_slash(value)

    @field_validator("label", "description", "prompt")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class SlashCommandUpdate(BaseModel):
    slash: Optional[str] = Field(default=None, min_length=2, max_length=64, pattern=r"^/?[a-z0-9][a-z0-9-]*$")
    label: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, min_length=1, max_length=255)
    prompt: Optional[str] = Field(default=None, min_length=1, max_length=5000)
    is_pinned: Optional[bool] = None
    position: Optional[int] = Field(default=None, ge=0)

    @field_validator("slash")
    @classmethod
    def normalize_command(cls, value: Optional[str]) -> Optional[str]:
        return normalize_slash(value) if value is not None else value

    @field_validator("label", "description", "prompt")
    @classmethod
    def strip_text(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() if value is not None else value


class SlashCommandResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    slash: str
    label: str
    description: str
    prompt: str
    is_pinned: bool
    position: int
    created_at: datetime
    updated_at: datetime
