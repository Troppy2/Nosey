from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SavedJDParsed(BaseModel):
    """The analysis and choices attached to a saved JD. Everything the Mock Interview
    setup panel needs to prefill itself without calling the LLM again."""
    role_focus: str = Field(default="", max_length=600)
    culture: str = Field(default="", max_length=600)
    seniority: str = Field(default="intern", max_length=16)
    topics: list[str] = Field(default_factory=list)
    subtopics: list[str] = Field(default_factory=list)
    difficulties: list[str] = Field(default_factory=list)


class JobDescriptionCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    company_name: Optional[str] = Field(default=None, max_length=120)
    # Same bound as JDParseRequest so a JD that can be parsed can always be saved.
    jd_text: str = Field(..., min_length=20, max_length=20000)
    parsed: Optional[SavedJDParsed] = Field(default=None)


class JobDescriptionUpdateRequest(BaseModel):
    """Every field optional: the setup panel saves over an existing JD after a re-parse
    or a topic tweak, and only sends what changed."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    company_name: Optional[str] = Field(default=None, max_length=120)
    jd_text: Optional[str] = Field(default=None, min_length=20, max_length=20000)
    parsed: Optional[SavedJDParsed] = Field(default=None)


class JobDescriptionResponse(BaseModel):
    id: int
    name: str
    company_name: Optional[str] = None
    jd_text: str
    parsed: Optional[SavedJDParsed] = None
    updated_at: Optional[str] = None
