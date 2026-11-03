from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


VALID_KINDS = frozenset({
    "free_text",
    "test",
    "module",
    "flashcards",
    "leetcode",
    "system_design",
    "mock_interview",
})


class StudyPlanItemBase(BaseModel):
    kind: str = Field(description="One of: free_text, test, module, flashcards, leetcode, system_design, mock_interview")
    label: str = Field(min_length=1, max_length=300)
    target_id: Optional[int] = None
    target_count: Optional[int] = None
    due_date: Optional[date] = None

    @field_validator("kind")
    @classmethod
    def _validate_kind(cls, value: str) -> str:
        if value not in VALID_KINDS:
            raise ValueError(f"Invalid kind: {value}. Must be one of {sorted(VALID_KINDS)}")
        return value


class StudyPlanItemCreate(StudyPlanItemBase):
    pass


class StudyPlanItemIn(StudyPlanItemBase):
    id: Optional[int] = None
    done: Optional[bool] = None


class StudyPlanItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plan_id: int
    position: int
    kind: str
    label: str
    target_id: Optional[int] = None
    target_count: Optional[int] = None
    due_date: Optional[date] = None
    done: bool
    done_at: Optional[datetime] = None
    done_source: Optional[str] = None
    progress: Optional[str] = None
    created_at: datetime


class StudyPlanCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    exam_date: Optional[date] = None
    is_pinned: bool = False
    items: list[StudyPlanItemCreate] = Field(default_factory=list)


class StudyPlanUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    exam_date: Optional[date] = None
    is_pinned: Optional[bool] = None


class StudyPlanReplaceItemsRequest(BaseModel):
    items: list[StudyPlanItemIn] = Field(default_factory=list)


class StudyPlanItemToggleRequest(BaseModel):
    done: bool


class StudyPlanSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    exam_date: Optional[date] = None
    is_pinned: bool
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    total_items: int = 0
    done_items: int = 0


class StudyPlanDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    exam_date: Optional[date] = None
    is_pinned: bool
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime] = None
    items: list[StudyPlanItemResponse] = Field(default_factory=list)


class CatalogItem(BaseModel):
    id: int
    title: str
    kind: str
    extra: Optional[str] = None


class CatalogResponse(BaseModel):
    tests: list[CatalogItem] = Field(default_factory=list)
    modules: list[CatalogItem] = Field(default_factory=list)
    flashcards: list[CatalogItem] = Field(default_factory=list)
    leetcode: list[CatalogItem] = Field(default_factory=list)
    system_design: list[CatalogItem] = Field(default_factory=list)
    mock_interview: list[CatalogItem] = Field(default_factory=list)


class StudyPlanDraftRequest(BaseModel):
    text: str = Field(min_length=1, max_length=6000)


class StudyPlanDraftResponse(BaseModel):
    title: str
    exam_date: Optional[date] = None
    items: list[StudyPlanItemCreate] = Field(default_factory=list)


class DashboardWidgetsUpdateRequest(BaseModel):
    widgets: list[str]

    @field_validator("widgets")
    @classmethod
    def _validate_widgets(cls, v: list[str]) -> list[str]:
        known = {"review_these", "weak_spots", "study_plan"}
        if len(v) != 2 or len(set(v)) != 2:
            raise ValueError("widgets must contain exactly 2 unique items")
        if not all(item in known for item in v):
            raise ValueError(f"widgets must only contain items from {sorted(known)}")
        return v
