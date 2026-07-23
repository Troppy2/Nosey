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
    # Category id string for struggle-event logging (client owns the topic taxonomy).
    topic: str = Field(..., min_length=1, max_length=120)


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
    # Category id string for struggle-event logging (client owns the topic taxonomy).
    topic: str = Field(..., min_length=1, max_length=120)


class LeetCodeGradeResponse(BaseModel):
    feedback: str
    flagged_uncertain: bool = False


# ── LeetCode sync (progress / activity / workspace) ──────────────────────────

class LCProgressResponse(BaseModel):
    progress: dict[str, bool]
    activity_dates: list[str]
    # Per-day solved tally keyed by YYYY-MM-DD. Every date in activity_dates has an
    # entry here (at least 1); clients that ignore it still get the day-level list.
    activity_counts: dict[str, int] = Field(default_factory=dict)


class LCProgressSyncRequest(BaseModel):
    progress: dict[str, bool] = Field(default_factory=dict)
    activity_dates: list[str] = Field(default_factory=list)
    activity_counts: dict[str, int] = Field(default_factory=dict)


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
    is_archived: bool = Field(default=False)

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


# ── Daily KojoCode ────────────────────────────────────────────────────────────

class LCDailyProblemRequest(BaseModel):
    """Client sends the weak topic, the target difficulty, and a seed problem slug it
    picked from the catalog it owns (the backend has no catalog to pick one itself).
    The backend reskins that seed into today's problem. The generated problem is
    returned as a normal LCCustomProblemResponse and locked to one per calendar day."""

    topic: str = Field(..., min_length=1, max_length=120)
    target_difficulty: str = Field(default="Medium", max_length=20)
    seed_slug: str = Field(..., min_length=1, max_length=200)
    provider: Optional[str] = Field(default=None)

    def normalized_difficulty(self) -> str:
        value = (self.target_difficulty or "").strip().capitalize()
        return value if value in ("Easy", "Medium", "Hard") else "Medium"


# ── Streak challenge (Save My Streak, beta-only) ──────────────────────────────

class LCStreakChallengeCreateRequest(BaseModel):
    # The client picks the rescue problem (it owns the verified catalog, the
    # difficulties, and the per-user completed state) and passes the slug here.
    # Optional so an empty POST still works and falls back to a server default.
    problem_slug: Optional[str] = None


class LCStreakChallengeResponse(BaseModel):
    id: int
    problem_slug: str
    expires_at: Optional[str] = None
    completed_at: Optional[str] = None
    created_at: str


# ── Struggle events + weakness scorer ─────────────────────────────────────────

class LCStruggleEventRequest(BaseModel):
    """Fired by the client's existing timer-expiry modal (it already knows the
    topic). hint_used and failed_grade events are inserted server-side by the hint
    and grade routes instead, since those already carry title_slug + topic."""

    topic: str = Field(..., min_length=1, max_length=120)
    event_type: str = Field(default="timer_expiry", max_length=20)
    # Lets the auto-add-drill hook (step 7) key a new drill row to a problem.
    problem_slug: Optional[str] = Field(default=None, max_length=200)


class LCWeaknessTopic(BaseModel):
    topic: str
    level: int


class LCWeaknessResponse(BaseModel):
    topics: list[LCWeaknessTopic] = Field(default_factory=list)


class LCTestRunRequest(BaseModel):
    """Logged each time the user runs their code against the test cases (client-side
    pyodide run). topic + difficulty are client-supplied since the backend owns no
    catalog to derive them from."""

    problem_slug: str = Field(..., min_length=1, max_length=200)
    topic: str = Field(..., min_length=1, max_length=120)
    difficulty: str = Field(default="unknown", max_length=20)
    passed: bool = Field(default=False)


class LCImprovementTopic(BaseModel):
    topic: str
    score: int
    reasons: list[str] = Field(default_factory=list)


class LCImprovementResponse(BaseModel):
    topics: list[LCImprovementTopic] = Field(default_factory=list)


class LCScoresResponse(BaseModel):
    """Weakness and improvement returned together so the frontend gets both in one
    GET /leetcode/weakness call."""

    weakness: LCWeaknessResponse = Field(default_factory=LCWeaknessResponse)
    improvement: LCImprovementResponse = Field(default_factory=LCImprovementResponse)


# ── Interview Prep Banks ──────────────────────────────────────────────────────

class LCPrepBankCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    target: str = Field(default="", max_length=200)


class LCPrepBankResponse(BaseModel):
    id: int
    name: str
    target: str
    is_active: bool
    problem_slugs: list[str] = Field(default_factory=list)
    created_at: str


class LCBankAddProblemRequest(BaseModel):
    problem_slug: str = Field(..., min_length=1, max_length=200)


class LCBankBulkAddRequest(BaseModel):
    slugs: list[str] = Field(default_factory=list)


# ── 3-Pass Drill schedule ──────────────────────────────────────────────────────

class LCDrillCreateRequest(BaseModel):
    problem_slug: str = Field(..., min_length=1, max_length=200)


class LCDrillAdvanceRequest(BaseModel):
    """Optional topic so the advance can log a drill_advanced_2/3/completed struggle
    event for the improvement/weakness scorers (lc_drill_schedule itself has no
    topic column). Body-less POSTs still work; the event is just skipped."""

    topic: Optional[str] = Field(default=None, max_length=120)


class LCDrillScheduleResponse(BaseModel):
    id: int
    problem_slug: str
    current_pass: int
    next_due_at: str
    added_from: str
    completed_at: Optional[str] = None