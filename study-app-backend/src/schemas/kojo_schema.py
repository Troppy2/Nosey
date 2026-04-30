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
    folder_id: int
    messages: list[KojoMessageDTO]
    created_at: datetime
    cleared_at: Optional[datetime] = None


class KojoChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class KojoChatResponse(BaseModel):
    response: str
    conversation_id: int
    message_id: int
    flagged_uncertain: bool = False


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
    folder_id: int
    folder_name: str
    cleared_at: datetime
    restore_expires_at: datetime
