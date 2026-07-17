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


class RenameConversationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class KojoChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=80000)
    provider: Optional[str] = Field(default=None, description="Optional LLM provider override: 'auto', 'groq', 'ollama', or 'gemini'")
    strictness: Optional[str] = Field(default="medium", description="Constitution strictness: 'strict', 'medium', or 'none'")
    conversation_id: Optional[int] = Field(default=None, description="Specific conversation to continue; if omitted uses latest for folder")
    reasoning: Optional[bool] = Field(default=False, description="Stream a visible reasoning pass before the answer (streaming endpoints only)")


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


class KojoBootstrapDTO(BaseModel):
    """Combined payload for the chat screen's initial load.

    Collapses the previous conversation-list, active-conversation, and
    session-files fetches into a single round-trip. `active` and `files`
    describe the most recent conversation (the one the UI opens by default).
    """

    conversations: list[KojoConversationSummaryDTO]
    active: Optional[KojoConversationDTO] = None
    files: list[ConversationFileDTO] = Field(default_factory=list)


class GeneralChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    provider: Optional[str] = Field(default=None)
    strictness: Optional[str] = Field(default="medium")
    reasoning: Optional[bool] = Field(default=False, description="Stream a visible reasoning pass before the answer (streaming endpoints only)")


ACTION_TYPES = {"create_folder", "create_flashcards", "create_module", "start_matching"}


class KojoActionCardDTO(BaseModel):
    id: int
    conversation_id: int
    message_id: Optional[int] = None
    action_type: str
    status: str
    payload: dict
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    # True when the created entity no longer exists (deleted from its own page)
    entity_deleted: bool = False
    created_at: datetime
    resolved_at: Optional[datetime] = None


class ProposeActionRequest(BaseModel):
    action_type: str = Field(..., description="create_folder | create_flashcards | create_module | start_matching")
    message: str = Field(..., min_length=1, max_length=8000)
    provider: Optional[str] = Field(default=None)
    message_id: Optional[int] = Field(default=None, description="User message the card anchors to")


class ResolveActionRequest(BaseModel):
    status: str = Field(..., description="confirmed | dismissed")
    entity_type: Optional[str] = Field(default=None, max_length=40)
    entity_id: Optional[int] = None
    payload: Optional[dict] = Field(default=None, description="Merged into the stored payload (edited fields, created entity title, etc.)")


class TestBlueprintRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    provider: Optional[str] = Field(default=None)


class TestBlueprintResponse(BaseModel):
    title: str
    test_type: str
    count_mcq: int
    count_frq: int
    difficulty: str
    topic_focus: Optional[str] = None
    intro: str
