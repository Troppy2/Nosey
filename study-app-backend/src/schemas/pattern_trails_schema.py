"""Request / response shapes for /pattern-trails (spec section 5)."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from src.schemas.leetcode_schema import LeetCodeExample

# getTimezoneOffset() range: UTC-14 .. UTC+12, in minutes behind UTC.
_TZ = Field(default=0, ge=-14 * 60, le=14 * 60)
_SECONDS = Field(..., ge=0, le=24 * 60 * 60)


# ── Shared pieces ─────────────────────────────────────────────────────────────


class PTPattern(BaseModel):
    key: str
    title: str


class PTRedoOut(BaseModel):
    id: int
    problem_slug: str
    step_id: Optional[int] = None
    subtopic_slug: Optional[str] = None
    position: Optional[int] = None
    gate_item_id: Optional[int] = None
    time_limit_s: int
    interval_index: int
    due_at: datetime
    due: bool
    last_result: str


class PTStats(BaseModel):
    """Rates are null until there is at least one sample."""

    recognition: Optional[float] = None
    picks: int = 0
    solve_rate: Optional[float] = None
    solve_attempts: int = 0
    weak: bool = False


# ── Map ───────────────────────────────────────────────────────────────────────


class PTSubtopicSummary(BaseModel):
    slug: str
    title: str
    summary: str
    open: bool
    finished: bool
    lesson_watched: bool
    step_states: list[str]
    passed_count: int
    stats: PTStats


class PTGateState(BaseModel):
    # locked (paths unfinished) | open | in_progress | cooldown (failed, 24h lock)
    state: str
    cleared: bool
    need: int
    size: int
    attempt_id: Optional[int] = None
    locked_until: Optional[datetime] = None
    best_correct: Optional[int] = None


class PTTopicSummary(BaseModel):
    slug: str
    title: str
    icon_key: Optional[str] = None
    subtopics: list[PTSubtopicSummary]
    finished: bool
    gate: PTGateState
    stats: PTStats


class PTWeakest(BaseModel):
    pattern: PTPattern
    topic_slug: str
    # recognition: solves it when told but misses it unlabeled | solve: misses it either way
    kind: str
    recognition: Optional[float] = None
    solve_rate: Optional[float] = None


class PTMapResponse(BaseModel):
    topics: list[PTTopicSummary]
    current_topic_slug: Optional[str] = None
    solved_total: int
    redos_due: list[PTRedoOut]
    redos_waiting: int
    weakest: Optional[PTWeakest] = None


# ── Path ──────────────────────────────────────────────────────────────────────


class PTLesson(BaseModel):
    lecture_slug: Optional[str] = None
    watched: bool
    watched_at: Optional[datetime] = None


class PTStepOut(BaseModel):
    id: int
    position: int
    problem_slug: str
    difficulty: str
    time_limit_s: int
    state: str
    locked_reason: Optional[str] = None
    attempts: int = 0
    best_seconds: Optional[int] = None
    passed_at: Optional[datetime] = None
    redo: Optional[PTRedoOut] = None


class PTPathResponse(BaseModel):
    topic_slug: str
    topic_title: str
    slug: str
    title: str
    summary: str
    cues: list[str]
    template_code: str
    open: bool
    locked_reason: Optional[str] = None
    lesson: PTLesson
    steps: list[PTStepOut]
    finished: bool
    solved_count: int
    next_subtopic_slug: Optional[str] = None


class PTStepResultRequest(BaseModel):
    # Kept for old clients; a step is one timed solve now, so it is ignored.
    pass_number: int = Field(3, ge=1, le=3)
    # Every test accepted on this run (the client's verdict). The server decides
    # whether that is a pass (pass 3, inside the time limit).
    accepted: bool
    seconds: int = _SECONDS
    tz_offset_minutes: int = _TZ


class PTStepResultResponse(BaseModel):
    passed: bool
    # Tests passed in time: the step now waits on the write-up (POST .../writeup).
    needs_writeup: bool = False
    slow: bool
    # 1 when Kojo walks (first pass of this step), else 0.
    solved_delta: int
    walked_to: Optional[int] = None
    redo: Optional[PTRedoOut] = None
    path_finished: bool
    next_subtopic_opened: Optional[str] = None
    gate_opened: bool
    path: PTPathResponse


class PTWriteupRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=12000)
    approach: str = Field(..., min_length=1, max_length=600)
    how_it_works: str = Field(..., min_length=1, max_length=1200)
    complexity: str = Field(..., min_length=1, max_length=400)
    thought_process: str = Field(..., min_length=1, max_length=1200)
    tz_offset_minutes: int = _TZ


class PTWriteupPart(BaseModel):
    ok: bool
    note: str


class PTWriteupGrade(BaseModel):
    approach: PTWriteupPart
    how_it_works: PTWriteupPart
    complexity: PTWriteupPart
    thought_process: PTWriteupPart
    summary: str


class PTWriteupResponse(BaseModel):
    # Null when Kojo could not grade it; the step then passes on the tests.
    grade: Optional[PTWriteupGrade] = None
    tries_left: int
    result: PTStepResultResponse


# ── Redos ─────────────────────────────────────────────────────────────────────


class PTRedoListResponse(BaseModel):
    due: list[PTRedoOut]
    waiting: list[PTRedoOut]


class PTRedoResultRequest(BaseModel):
    accepted: bool
    seconds: int = _SECONDS


class PTRedoResultResponse(BaseModel):
    passed: bool
    retired: bool
    redo: Optional[PTRedoOut] = None


# ── Gate ──────────────────────────────────────────────────────────────────────


class PTGateItemOut(BaseModel):
    """Never carries the problem slug, title or tags. After the pick it carries the
    verdict, the right pattern and the cue."""

    id: int
    position: int
    difficulty: str
    time_limit_s: int
    picked_key: Optional[str] = None
    correct: Optional[bool] = None
    right_pattern: Optional[PTPattern] = None
    cue: Optional[str] = None
    kojo_note: Optional[str] = None
    solved: Optional[bool] = None
    seconds: Optional[int] = None


class PTGateAttemptOut(BaseModel):
    attempt_id: int
    topic_slug: str
    topic_title: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    picks_made: int
    correct_count: int
    need: int
    passed: Optional[bool] = None
    locked_until: Optional[datetime] = None
    options: list[PTPattern]
    items: list[PTGateItemOut]


class PTGateProblemOut(BaseModel):
    """The statement for a gate item: no title, slug or topic tags."""

    item_id: int
    difficulty: str
    statement_text: Optional[str] = None
    content_html: str
    examples: list[LeetCodeExample]
    example_testcases: list[str]
    python_snippet: Optional[str] = None


class PTPickRequest(BaseModel):
    item_id: int
    picked_key: str = Field(..., min_length=1, max_length=120)
    reason: str = Field(..., min_length=1, max_length=200)


class PTPickResponse(BaseModel):
    item_id: int
    correct: bool
    right_pattern: PTPattern
    cue: str
    # Null when Kojo could not write one (provider failure, timeout, limits).
    kojo_note: Optional[str] = None
    attempt: PTGateAttemptOut


class PTGateSolveRequest(BaseModel):
    item_id: int
    accepted: bool
    seconds: int = _SECONDS


class PTGateSolveResponse(BaseModel):
    item_id: int
    solved: bool
    slow: bool
    redo: Optional[PTRedoOut] = None
