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
    stage1_results: Optional[str] = None
    stage2_script: Optional[str] = None
    stage2_submission: Optional[str] = None
    stage3_script: Optional[str] = None
    stage3_answers: Optional[str] = None
    overall_feedback: Optional[str] = None


# Stage 1 grading
class Stage1Submission(BaseModel):
    slug: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    difficulty: str = Field(..., min_length=1)
    code: str = Field(default="", max_length=20000)
    time_used_ms: int = Field(default=0)
    test_results: str = Field(default="[]", max_length=5000)
    all_passed: bool = Field(default=False)


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


# Stage 2 script generation
class Stage2ScriptRequest(BaseModel):
    provider: Optional[str] = Field(default=None)


class Stage2ScriptLine(BaseModel):
    speaker: str          # "interviewer" | "prompt"
    text: str
    is_coding_prompt: bool = False


class Stage2ScriptResponse(BaseModel):
    script_lines: list[Stage2ScriptLine]
    coding_slug: Optional[str] = None
    coding_title: Optional[str] = None
    coding_difficulty: Optional[str] = None


# Stage 2 submission
class Stage2SubmitRequest(BaseModel):
    code: str = Field(default="", max_length=20000)
    provider: Optional[str] = Field(default=None)


class Stage2SubmitResponse(BaseModel):
    feedback: str


# Stage 2 live chat (legacy — kept for backwards compat)
class Stage2ChatMessage(BaseModel):
    role: str   # "user" | "interviewer"
    text: str


class Stage2ChatRequest(BaseModel):
    message: str = Field(..., max_length=2000)
    history: list[Stage2ChatMessage] = Field(default=[])
    provider: Optional[str] = Field(default=None)


class Stage2ChatResponse(BaseModel):
    reply: str


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


# Stage 3 script generation (legacy)
class Stage3ScriptRequest(BaseModel):
    provider: Optional[str] = Field(default=None)


class Stage3Question(BaseModel):
    index: int
    question: str
    follow_up: Optional[str] = None


class Stage3ScriptResponse(BaseModel):
    questions: list[Stage3Question]
    opening: str


# Stage 3 answers submission (legacy)
class Stage3AnswersRequest(BaseModel):
    answers: list[str]
    provider: Optional[str] = Field(default=None)


class Stage3AnswersResponse(BaseModel):
    feedback: str


# Final summary
class FinishRequest(BaseModel):
    provider: Optional[str] = Field(default=None)


class FinishResponse(BaseModel):
    overall_feedback: str
    stage1_verdict: Optional[str] = None
    stage2_verdict: Optional[str] = None
    stage3_verdict: Optional[str] = None
    hiring_recommendation: str
