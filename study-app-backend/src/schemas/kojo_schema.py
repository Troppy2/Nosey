from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class KojoMessageDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    created_at: datetime


class KojoConversationDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_id: Optional[int] = None
    messages: list[KojoMessageDTO]
    created_at: datetime
    cleared_at: Optional[datetime] = None


class KojoConversationSummaryDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: Optional[str] = None
    folder_id: Optional[int] = None
    created_at: datetime


class KojoChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    provider: Optional[str] = Field(default=None, description="Optional LLM provider override: 'auto', 'groq', 'ollama', or 'gemini'")
    strictness: Optional[str] = Field(default="medium", description="Constitution strictness: 'strict', 'medium', or 'none'")
    conversation_id: Optional[int] = Field(default=None, description="Specific conversation to continue; if omitted uses latest for folder")


class KojoChatResponse(BaseModel):
    response: str
    conversation_id: int
    message_id: int
    flagged_uncertain: bool = False
    conversation_name: Optional[str] = None


class KojoClearResponse(BaseModel):
    conversation_id: int
    folder_id: int
    cleared_at: datetime
    restore_expires_at: datetime


class KojoRestoreResponse(BaseModel):
    folder_id: int
    restored: bool


class KojoClearedConversationDTO(BaseModel):
    conversation_id: int
    folder_id: Optional[int] = None
    folder_name: str
    cleared_at: datetime
    restore_expires_at: datetime


class ConversationFileDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_name: str
    file_type: str
    size_bytes: int
    uploaded_at: datetime


class GeneralChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    provider: Optional[str] = Field(default=None)
    strictness: Optional[str] = Field(default="medium")


class TestBlueprintRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    provider: Optional[str] = Field(default=None)


class TestBlueprintResponse(BaseModel):
    title: str
    test_type: str
    count_mcq: int
    count_frq: int
    difficulty: str
    topic_focus: Optional[str] = None
    intro: str
