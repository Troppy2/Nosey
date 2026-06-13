from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class MockInterviewCreateRequest(BaseModel):
    company: str = Field(..., min_length=1, max_length=64)
    stages: list[str] = Field(default=["stage1", "stage2", "stage3"])


class MockInterviewSessionResponse(BaseModel):
    id: int
    company: str
    stages_config: str
    status: str
    resume_screen: Optional[str] = None
    stage1_results: Optional[str] = None
    stage2_script: Optional[str] = None
    stage2_submission: Optional[str] = None
    stage3_script: Optional[str] = None
    stage3_answers: Optional[str] = None
    overall_feedback: Optional[str] = None


# Resume Screen (optional first stage): simulated ATS evaluation.
class ResumeScreenResult(BaseModel):
    ats_score: int = Field(default=0, ge=0, le=100)
    passes_oa: bool = False
    verdict: str = ""               # short label, e.g. "Likely to pass the screen"
    matched_keywords: list[str] = Field(default_factory=list)
    missing_keywords: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    fixes: list[str] = Field(default_factory=list)
    summary: str = ""


# Stage 1 grading
class Stage1Submission(BaseModel):
    slug: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    difficulty: str = Field(..., min_length=1)
    code: str = Field(default="", max_length=20000)
    time_used_ms: int = Field(default=0)
    test_results: str = Field(default="[]", max_length=20000)
    all_passed: bool = Field(default=False)
    # Real execution counts from the in-app Pyodide runner. tests_total == 0
    # means the problem could not be executed (verdict falls back to heuristics).
    tests_passed: int = Field(default=0, ge=0)
    tests_total: int = Field(default=0, ge=0)


class Stage1GradeRequest(BaseModel):
    submissions: list[Stage1Submission]
    provider: Optional[str] = Field(default=None)


class Stage1QuestionResult(BaseModel):
    slug: str
    title: str
    difficulty: str
    code: str
    time_used_ms: int
    verdict: str          # "strong" | "pass" | "borderline" | "needs_work"
    feedback: str


class Stage1GradeResponse(BaseModel):
    results: list[Stage1QuestionResult]


# Stage 2 submission
class Stage2SubmitRequest(BaseModel):
    code: str = Field(default="", max_length=20000)
    problem_title: str = Field(default="the coding problem", max_length=200)
    problem_slug: str = Field(default="", max_length=200)
    provider: Optional[str] = Field(default=None)


class Stage2SubmitResponse(BaseModel):
    feedback: str


# ── Conversational interview (Stage 2 + Stage 3) ──────────────────────────────

class InterviewChatMessage(BaseModel):
    role: str    # "user" | "interviewer"
    content: str


class CodingProblemInfo(BaseModel):
    title: str
    slug: str
    difficulty: str
    prompt: str


class Stage2MessageRequest(BaseModel):
    message: Optional[str] = Field(default=None, max_length=3000)
    history: list[InterviewChatMessage] = Field(default=[])
    provider: Optional[str] = Field(default=None)


class Stage2MessageResponse(BaseModel):
    reply: str
    coding_problem: Optional[CodingProblemInfo] = None
    is_done: bool = False


class Stage3MessageRequest(BaseModel):
    message: Optional[str] = Field(default=None, max_length=3000)
    history: list[InterviewChatMessage] = Field(default=[])
    provider: Optional[str] = Field(default=None)


class Stage3MessageResponse(BaseModel):
    reply: str
    is_done: bool = False


# Final summary
class FinishRequest(BaseModel):
    provider: Optional[str] = Field(default=None)


class FinishResponse(BaseModel):
    overall_feedback: str
    resume_verdict: Optional[str] = None
    stage1_verdict: Optional[str] = None
    stage2_verdict: Optional[str] = None
    stage3_verdict: Optional[str] = None
    hiring_recommendation: str
