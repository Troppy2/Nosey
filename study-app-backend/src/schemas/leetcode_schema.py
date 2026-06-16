from __future__ import annotations

from typing import Any, Optional

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
    # For user-authored custom problems there is no official statement to fetch, so the
    # client passes the problem text directly and we skip the LeetCode GraphQL call.
    statement: str = Field(default="", max_length=20000)


class LeetCodeHintResponse(BaseModel):
    response: str
    flagged_uncertain: bool = False


class LeetCodeGradeRequest(BaseModel):
    title_slug: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    user_code: str = Field(default="", max_length=20000)
    test_results: str = Field(..., max_length=5000, description="JSON-serialized test case results")
    all_passed: bool = Field(default=False)
    provider: Optional[str] = Field(default=None)
    # See LeetCodeHintRequest.statement: lets custom problems be graded without a fetch.
    statement: str = Field(default="", max_length=20000)


class LeetCodeGradeResponse(BaseModel):
    feedback: str
    flagged_uncertain: bool = False


# ── LeetCode sync (progress / activity / workspace) ──────────────────────────

class LCProgressResponse(BaseModel):
    progress: dict[str, bool]
    activity_dates: list[str]


class LCProgressSyncRequest(BaseModel):
    progress: dict[str, bool] = Field(default_factory=dict)
    activity_dates: list[str] = Field(default_factory=list)


class LCWorkspaceResponse(BaseModel):
    workspace: Optional[Any] = None


class LCWorkspacesResponse(BaseModel):
    workspaces: dict[str, Any] = Field(default_factory=dict)


class LCWorkspaceSyncRequest(BaseModel):
    workspace: Any = Field(...)

class LCNotesSyncRequest(BaseModel):
    notes: str = Field(default="", max_length=10000)


class LCNotesResponse(BaseModel):
    notes: str = ""


# ── Custom (user-authored) LeetCode problems ─────────────────────────────────

_ALLOWED_DIFFICULTIES = {"Easy", "Medium", "Hard", "unknown"}


class LCCustomTestCase(BaseModel):
    input_text: str = Field(default="", max_length=4000)
    output_text: str = Field(default="", max_length=4000)
    explanation_text: Optional[str] = Field(default=None, max_length=4000)


class LCCustomProblemBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    topic: str = Field(default="unknown", max_length=120)
    difficulty: str = Field(default="unknown", max_length=20)
    description: str = Field(default="", max_length=20000)
    url: str = Field(default="", max_length=2000)
    starter_code: str = Field(default="", max_length=20000)
    test_cases: list[LCCustomTestCase] = Field(default_factory=list)

    def normalized_difficulty(self) -> str:
        return self.difficulty if self.difficulty in _ALLOWED_DIFFICULTIES else "unknown"


class LCCustomProblemSyncRequest(LCCustomProblemBase):
    """Upsert payload for a single custom problem (keyed by slug in the URL)."""


class LCCustomProblemResponse(LCCustomProblemBase):
    slug: str


class LCCustomProblemListResponse(BaseModel):
    problems: list[LCCustomProblemResponse] = Field(default_factory=list)


class LCGenerateCustomProblemRequest(BaseModel):
    """The user pastes a function (or any code) and optionally a short hint of intent.
    The AI fills in the rest: title, topic, difficulty, a written walkthrough, worked
    examples, and runnable test cases."""

    code: str = Field(default="", max_length=20000)
    hint: str = Field(default="", max_length=2000)
    provider: Optional[str] = Field(default=None)


class LCGeneratedCustomProblem(BaseModel):
    title: str = ""
    topic: str = "unknown"
    difficulty: str = "unknown"
    description: str = ""
    starter_code: str = ""
    test_cases: list[LCCustomTestCase] = Field(default_factory=list)