from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class LeetCodeExample(BaseModel):
    index: int
    input_text: str
    output_text: str
    explanation_text: Optional[str] = None


class LeetCodeTopicTag(BaseModel):
    name: str
    slug: str


class LeetCodeProblemResponse(BaseModel):
    title: str
    title_slug: str
    difficulty: str
    content_html: str
    examples: list[LeetCodeExample]
    example_testcases: list[str]
    python_snippet: Optional[str] = None
    topic_tags: list[LeetCodeTopicTag]


class LeetCodeHintRequest(BaseModel):
    title_slug: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1, max_length=2500)
    user_code: str = Field(default="", max_length=20000)
    provider: Optional[str] = Field(default=None)
    beta_enabled: bool = Field(default=False)


class LeetCodeHintResponse(BaseModel):
    response: str
    flagged_uncertain: bool = False
