from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.mock_interview import MockInterviewSession
from src.models.user import User
from src.schemas.mock_interview_schema import (
    CodingProblemInfo,
    FinishRequest,
    FinishResponse,
    InterviewChatMessage,
    MockInterviewCreateRequest,
    MockInterviewSessionResponse,
    ResumeScreenResult,
    Stage1GradeRequest,
    Stage1GradeResponse,
    Stage1QuestionResult,
    Stage2MessageRequest,
    Stage2MessageResponse,
    Stage2SubmitRequest,
    Stage2SubmitResponse,
    Stage3MessageRequest,
    Stage3MessageResponse,
)
from src.limiter import limiter
from src.services.file_service import FileService
from src.services.leetcode_service import LeetCodeService
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ValidationException

router = APIRouter(prefix="/mock-interview", tags=["mock-interview"])

# Canonical session lifecycle. A session moves forward only; the frontend
# resumes from its own localStorage snapshot, while these values let the
# summary endpoint know which stages produced gradable artifacts.
STATUS_PENDING = "pending"
STATUS_RESUME_COMPLETE = "resume_complete"
STATUS_STAGE1_COMPLETE = "stage1_complete"
STATUS_STAGE2 = "stage2"
STATUS_STAGE2_COMPLETE = "stage2_complete"
STATUS_STAGE3 = "stage3"
STATUS_STAGE3_COMPLETE = "stage3_complete"
STATUS_COMPLETE = "complete"

_COMPANY_LABELS = {
    "google": "Google",
    "meta": "Meta",
    "amazon": "Amazon",
    "apple": "Apple",
    "microsoft": "Microsoft",
    "netflix": "Netflix",
    "random": "a top-tier tech company",
}


def _candidate_name(user: User) -> str:
    if user.full_name:
        return user.full_name.split()[0]
    return "there"


def _get_session_or_404(session_row: Optional[MockInterviewSession]) -> MockInterviewSession:
    if session_row is None:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    return session_row


async def _load_session(
    session_id: int,
    user: User,
    db: AsyncSession,
) -> MockInterviewSession:
    row = (
        await db.execute(
            select(MockInterviewSession).where(
                MockInterviewSession.id == session_id,
                MockInterviewSession.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    return _get_session_or_404(row)


# ── Create session ────────────────────────────────────────────────────────────

@router.post("", response_model=MockInterviewSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: MockInterviewCreateRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MockInterviewSessionResponse:
    stages = [s for s in body.stages if s in ("resume", "stage1", "stage2", "stage3")]
    if not stages:
        stages = ["resume", "stage1", "stage2", "stage3"]

    session = MockInterviewSession(
        user_id=user.id,
        company=body.company.lower(),
        stages_config=json.dumps(stages),
        status=STATUS_PENDING,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _to_response(session)


# ── Get session ───────────────────────────────────────────────────────────────

@router.get("/{session_id}", response_model=MockInterviewSessionResponse)
async def get_session_route(
    session_id: int,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MockInterviewSessionResponse:
    row = await _load_session(session_id, user, db)
    return _to_response(row)


# ── Resume Screen: simulated ATS evaluation ───────────────────────────────────

_COMPANY_ROLE_FOCUS = {
    "google": "algorithmic depth, systems thinking, scalable distributed systems, and strong CS fundamentals",
    "meta": "fast execution, product impact, large-scale systems, and ownership",
    "amazon": "scalability, operational excellence, ownership, and customer-facing impact (Leadership Principles)",
    "apple": "craftsmanship, low-level/performance work, attention to detail, and cross-functional polish",
    "microsoft": "collaboration, breadth across the stack, customer empathy, and growth mindset",
    "netflix": "senior-level autonomy, high-impact systems, and strong judgment",
}


def _resume_verdict_label(score: int, passes: bool) -> str:
    if passes and score >= 80:
        return "Strong resume, very likely to pass the screen"
    if passes:
        return "Solid resume, likely to land an OA"
    if score >= 50:
        return "Borderline, may be filtered by ATS"
    return "Below the bar, unlikely to pass the screen as-is"


@router.post("/{session_id}/resume/screen", response_model=ResumeScreenResult)
@limiter.limit("5/minute")
async def screen_resume(
    request: Request,
    session_id: int,
    resume_file: Optional[UploadFile] = File(default=None),
    resume_text: Optional[str] = Form(default=None),
    provider: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ResumeScreenResult:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())
    role_focus = _COMPANY_ROLE_FOCUS.get(row.company, "strong CS fundamentals and engineering impact")

    # Resume text comes either from an uploaded file (PDF/DOCX/...) or pasted
    # text/LaTeX. Files take priority when both are present.
    text = ""
    if resume_file is not None and resume_file.filename:
        try:
            text, _ = await FileService().extract_from_file(resume_file)
        except ValidationException as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read the resume file: {exc}") from exc
    elif resume_text:
        text = resume_text

    text = (text or "").strip()
    if len(text) < 40:
        raise HTTPException(
            status_code=400,
            detail="Please provide a resume: upload a PDF/DOCX or paste your resume text or LaTeX.",
        )

    # Keep the prompt bounded; resumes are short, but guard against huge pastes.
    text = text[:12000]

    prompt = (
        "You are an Applicant Tracking System (ATS) combined with a technical recruiter doing the "
        f"first resume screen for a software engineering role at {company_label}. "
        f"This company weighs: {role_focus}.\n\n"
        "Evaluate the resume below the way an ATS plus a recruiter would: keyword and skills match for "
        "the role, parse-ability and formatting, relevance and depth of experience, signal of impact "
        "(metrics, scope), and overall whether this candidate would clear the screen and be sent an "
        "Online Assessment (OA).\n\n"
        "RESPOND WITH ONLY RAW JSON, no markdown fences, no extra text, in exactly this shape:\n"
        "{\n"
        '  "ats_score": 0-100 integer,\n'
        '  "passes_oa": true or false,\n'
        '  "verdict": "one short sentence",\n'
        '  "matched_keywords": ["..."],\n'
        '  "missing_keywords": ["..."],\n'
        '  "strengths": ["2 to 3 short bullet strings"],\n'
        '  "gaps": ["2 to 3 short bullet strings"],\n'
        '  "fixes": ["2 to 3 concrete, specific improvements"],\n'
        '  "summary": "2 to 3 sentence overall read"\n'
        "}\n\n"
        "Be honest and specific. passes_oa should be true only when the resume genuinely clears a "
        f"{company_label} screen. Do not invent experience that is not in the resume.\n\n"
        f"RESUME:\n{text}\n\nYour JSON response:"
    )

    try:
        llm = LLMService()
        raw = await llm.call_kojo(prompt, provider=provider)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
    except (json.JSONDecodeError, LLMException) as exc:
        raise HTTPException(status_code=503, detail=f"Failed to screen the resume: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to screen the resume: {exc}") from exc

    def _str_list(value) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(v).strip() for v in value if str(v).strip()][:8]

    try:
        score = int(parsed.get("ats_score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))
    passes = bool(parsed.get("passes_oa", False))

    result = ResumeScreenResult(
        ats_score=score,
        passes_oa=passes,
        verdict=str(parsed.get("verdict") or _resume_verdict_label(score, passes))[:200],
        matched_keywords=_str_list(parsed.get("matched_keywords")),
        missing_keywords=_str_list(parsed.get("missing_keywords")),
        strengths=_str_list(parsed.get("strengths")),
        gaps=_str_list(parsed.get("gaps")),
        fixes=_str_list(parsed.get("fixes")),
        summary=str(parsed.get("summary") or "")[:1200],
    )

    row.resume_screen = json.dumps(result.model_dump())
    if row.status == STATUS_PENDING:
        row.status = STATUS_RESUME_COMPLETE
    await db.commit()

    return result


# ── Stage 1: grade submissions ────────────────────────────────────────────────

@router.post("/{session_id}/stage1/grade", response_model=Stage1GradeResponse)
@limiter.limit("5/minute")
async def grade_stage1(
    request: Request,
    session_id: int,
    body: Stage1GradeRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage1GradeResponse:
    row = await _load_session(session_id, user, db)

    svc = LeetCodeService()

    async def _grade_one(sub) -> Stage1QuestionResult:
        # Verdict comes first from the real in-app execution counts so it is
        # deterministic; the LLM only writes prose feedback and can never flip
        # a passing run to a fail (or vice versa).
        verdict = _derive_verdict(
            all_passed=sub.all_passed,
            tests_passed=sub.tests_passed,
            tests_total=sub.tests_total,
            code=sub.code,
        )
        try:
            result = await svc.grade(
                title_slug=sub.slug,
                title=sub.title,
                user_code=sub.code,
                test_results=sub.test_results,
                all_passed=sub.all_passed,
                provider=body.provider,
            )
            feedback = result.feedback
        except Exception:
            feedback = _fallback_feedback(verdict, sub.tests_passed, sub.tests_total)

        return Stage1QuestionResult(
            slug=sub.slug,
            title=sub.title,
            difficulty=sub.difficulty,
            code=sub.code,
            time_used_ms=sub.time_used_ms,
            verdict=verdict,
            feedback=feedback,
        )

    results = await asyncio.gather(*[_grade_one(s) for s in body.submissions])

    row.stage1_results = json.dumps([r.model_dump() for r in results])
    row.status = STATUS_STAGE1_COMPLETE
    await db.commit()

    return Stage1GradeResponse(results=list(results))


def _derive_verdict(all_passed: bool, tests_passed: int, tests_total: int, code: str) -> str:
    """Map real execution results to a verdict.

    When tests actually ran (tests_total > 0) the verdict is purely a function
    of the pass ratio. When the problem could not be executed (tests_total == 0)
    we fall back to whether any code was written.
    """
    has_code = bool(code.strip())
    if tests_total > 0:
        if all_passed or tests_passed >= tests_total:
            return "strong"
        if tests_passed > 0:
            return "borderline"
        return "needs_work" if not has_code else "borderline"
    # No execution signal available.
    if all_passed:
        return "pass"
    if not has_code:
        return "needs_work"
    return "borderline" if len(code.strip()) > 50 else "needs_work"


def _fallback_feedback(verdict: str, tests_passed: int, tests_total: int) -> str:
    if tests_total > 0:
        ran = f"You passed {tests_passed} of {tests_total} sample test cases. "
    else:
        ran = ""
    tail = {
        "strong": "Clean, working solution. Tighten the explanation of your time and space complexity next time.",
        "pass": "Solid attempt that meets the bar. Double-check edge cases under interview pressure.",
        "borderline": "Partially working. Revisit the failing cases and the core data structure choice.",
        "needs_work": "This needs more work. Start from the brute-force approach, then optimize.",
    }.get(verdict, "Keep practicing this pattern.")
    return ran + tail


# ── Stage 2: submit coding answer ─────────────────────────────────────────────

@router.post("/{session_id}/stage2/submit", response_model=Stage2SubmitResponse)
@limiter.limit("5/minute")
async def submit_stage2(
    request: Request,
    session_id: int,
    body: Stage2SubmitRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage2SubmitResponse:
    row = await _load_session(session_id, user, db)

    coding_slug = body.problem_slug or "unknown"
    coding_title = body.problem_title or "the coding problem"
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())
    candidate = _candidate_name(user)

    prompt = (
        f"You are a senior {company_label} interviewer reviewing {candidate}'s solution.\n"
        f"Problem: {coding_title} ({coding_slug})\n\n"
        f"{candidate}'s code:\n```python\n{body.code}\n```\n\n"
        f"Provide brief interview-style feedback (3-4 sentences) addressed directly to {candidate}: "
        "correctness, approach quality, time/space complexity, and one improvement suggestion. "
        "Be professional and constructive."
    )

    try:
        llm = LLMService()
        feedback = await llm.call_kojo(prompt, provider=body.provider)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    row.stage2_submission = json.dumps({"code": body.code, "feedback": feedback})
    row.status = STATUS_STAGE2_COMPLETE
    await db.commit()

    return Stage2SubmitResponse(feedback=feedback)


# ── Stage 2: conversational interview ────────────────────────────────────────

@router.post("/{session_id}/stage2/message", response_model=Stage2MessageResponse)
@limiter.limit("5/minute")
async def stage2_message(
    request: Request,
    session_id: int,
    body: Stage2MessageRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage2MessageResponse:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())
    candidate = _candidate_name(user)

    turn_count = sum(1 for m in body.history if m.role == "user")

    history_text = "\n".join(
        f"{'You (Interviewer)' if m.role == 'interviewer' else candidate}: {m.content}"
        for m in body.history
    )

    coding_difficulty = "Medium/Hard" if row.company in ("google", "meta") else "Medium"

    system_prompt = (
        f"You are a senior software engineer at {company_label} conducting a 45-minute technical phone screen with {candidate}.\n\n"
        "RESPOND WITH ONLY RAW JSON, no markdown fences, no extra text:\n"
        '{"reply": "...", "coding_problem": null, "is_done": false}\n\n'
        f"CURRENT USER TURN: {turn_count + 1}\n\n"
        "INTERVIEW PHASES (follow strictly based on turn count):\n"
        f"- Turns 1 to 3: Warm greeting, ask about {candidate}'s background (current role, relevant experience, why {company_label})\n"
        "- Turns 4 to 5: Ask 2 technical conceptual questions (time complexity, data structure tradeoffs, algorithm design)\n"
        f"- Turn 6: Present ONE {coding_difficulty} LeetCode problem by filling the coding_problem field:\n"
        '  {"title":"Two Sum","slug":"two-sum","difficulty":"Medium","prompt":"Given an array..."}\n'
        "- Turns 7+: Discuss the problem and answer clarifying questions without giving away the full solution. coding_problem MUST be null.\n\n"
        "RULES:\n"
        "- reply: 2 to 4 sentences max. Be direct and conversational.\n"
        f"- Use {candidate}'s name occasionally (not every message).\n"
        "- coding_problem must appear ONCE only (null in all other turns).\n"
        "- The candidate submits their code with a separate button, so always keep is_done false.\n"
        "- Return ONLY raw JSON.\n"
    )

    if body.message is None:
        full_prompt = system_prompt + "\nConversation so far:\n(none)\n\nBegin the interview now."
    else:
        full_prompt = (
            system_prompt
            + f"\nConversation so far:\n{history_text}\n\n"
            + f"{candidate}: {body.message}\n\nYour JSON response:"
        )

    try:
        llm = LLMService()
        raw = await llm.call_kojo(full_prompt, provider=body.provider)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
    except Exception:
        fallback = raw if isinstance(raw, str) and raw else "I see, thanks for sharing that. Let's continue."
        return Stage2MessageResponse(reply=fallback[:600])

    coding_problem = None
    if parsed.get("coding_problem"):
        cp = parsed["coding_problem"]
        coding_problem = CodingProblemInfo(
            title=cp.get("title", "Coding Problem"),
            slug=cp.get("slug", "problem"),
            difficulty=cp.get("difficulty", "Medium"),
            prompt=cp.get("prompt", ""),
        )

    row.status = STATUS_STAGE2
    await db.commit()

    return Stage2MessageResponse(
        reply=parsed.get("reply", ""),
        coding_problem=coding_problem,
        is_done=False,
    )


# ── Stage 3: conversational behavioral interview ──────────────────────────────

_COMPANY_CULTURE = {
    "google": "Googleyness and Leadership: ambiguity tolerance, collaboration, impact at scale",
    "meta": "Move Fast: bias for action, ownership, data-driven decisions, building at scale",
    "amazon": "Leadership Principles: Customer Obsession, Ownership, Invent and Simplify, Deliver Results",
    "apple": "craftsmanship, attention to detail, simplicity, cross-functional teamwork",
    "microsoft": "growth mindset, customer empathy, collaboration, inclusive leadership",
    "netflix": "Freedom and Responsibility: judgment, courage, transparency, impact over process",
}


@router.post("/{session_id}/stage3/message", response_model=Stage3MessageResponse)
@limiter.limit("5/minute")
async def stage3_message(
    request: Request,
    session_id: int,
    body: Stage3MessageRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage3MessageResponse:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())
    candidate = _candidate_name(user)
    culture_hint = _COMPANY_CULTURE.get(row.company, "performance, teamwork, and impact")

    turn_count = sum(1 for m in body.history if m.role == "user")

    history_text = "\n".join(
        f"{'You (Interviewer)' if m.role == 'interviewer' else candidate}: {m.content}"
        for m in body.history
    )

    system_prompt = (
        f"You are a hiring manager at {company_label} conducting a 30-minute behavioral interview with {candidate}.\n"
        f"Company culture: {culture_hint}\n\n"
        "RESPOND WITH ONLY RAW JSON, no markdown, no extra text:\n"
        '{"reply": "...", "is_done": false}\n\n'
        f"USER TURNS SO FAR: {turn_count}\n\n"
        "INTERVIEW FLOW:\n"
        f"- If turn_count == 0: Warm greeting plus ask the FIRST behavioral STAR question tailored to {company_label}\n"
        "- After each answer: 1 sentence acknowledgment, then ask the NEXT question (one at a time)\n"
        f"- Cover 5 behavioral questions total focused on {company_label}'s culture above\n"
        "- After 5 user answers are given and acknowledged: wrap up warmly, set is_done: true\n\n"
        "RULES:\n"
        "- reply: 2 to 3 sentences max\n"
        "- Ask ONE question per turn\n"
        f"- Use {candidate}'s name occasionally\n"
        "- Be warm but professional\n"
        "- Return ONLY raw JSON\n"
    )

    if body.message is None:
        full_prompt = system_prompt + "\nConversation so far:\n(none)\n\nBegin the interview now."
    else:
        full_prompt = (
            system_prompt
            + f"\nConversation so far:\n{history_text}\n\n"
            + f"{candidate}: {body.message}\n\nYour JSON response:"
        )

    try:
        llm = LLMService()
        raw = await llm.call_kojo(full_prompt, provider=body.provider)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
    except Exception:
        fallback = raw if isinstance(raw, str) and raw else "Thank you for sharing. Could you tell me more?"
        return Stage3MessageResponse(reply=fallback[:600])

    is_done = bool(parsed.get("is_done", False))

    if is_done and body.message is not None:
        # Save conversation as stage3 feedback for the final summary
        await _save_stage3_conversation_feedback(
            row=row,
            history=body.history + [InterviewChatMessage(role="user", content=body.message)],
            company_label=company_label,
            candidate=candidate,
            db=db,
            provider=body.provider,
        )
    else:
        row.status = STATUS_STAGE3
        await db.commit()

    return Stage3MessageResponse(
        reply=parsed.get("reply", ""),
        is_done=is_done,
    )


async def _save_stage3_conversation_feedback(
    row: MockInterviewSession,
    history: list[InterviewChatMessage],
    company_label: str,
    candidate: str,
    db: AsyncSession,
    provider: Optional[str],
) -> None:
    qa_text = "\n\n".join(
        f"{'Interviewer' if m.role == 'interviewer' else candidate}: {m.content}"
        for m in history
    )
    eval_prompt = (
        f"You are a {company_label} hiring manager reviewing a behavioral interview transcript.\n\n"
        f"{qa_text}\n\n"
        f"In 2 to 3 sentences, evaluate {candidate}'s overall behavioral responses: "
        "what was strong, what needs improvement, and whether they align with the company's culture. "
        "Be direct and professional."
    )
    try:
        llm = LLMService()
        feedback = await llm.call_kojo(eval_prompt, provider=provider)
    except Exception:
        feedback = "Behavioral evaluation unavailable."

    row.stage3_answers = json.dumps({"feedback": feedback.strip()})
    row.status = STATUS_STAGE3_COMPLETE
    await db.commit()


# ── Finish: overall summary ───────────────────────────────────────────────────

@router.post("/{session_id}/finish", response_model=FinishResponse)
@limiter.limit("5/minute")
async def finish_interview(
    request: Request,
    session_id: int,
    body: FinishRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FinishResponse:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())

    stage1_verdict = _stage1_overall_verdict(row.stage1_results)
    stage2_verdict = _stage2_overall_verdict(row.stage2_submission)
    stage3_verdict = _stage3_overall_verdict(row.stage3_answers)
    resume_verdict = _resume_overall_verdict(row.resume_screen)

    # The summary page calls this on every mount. Once a debrief exists, return
    # the cached copy instead of paying for another LLM generation.
    if row.status == STATUS_COMPLETE and row.overall_feedback:
        return FinishResponse(
            overall_feedback=row.overall_feedback,
            resume_verdict=resume_verdict,
            stage1_verdict=stage1_verdict,
            stage2_verdict=stage2_verdict,
            stage3_verdict=stage3_verdict,
            hiring_recommendation=_extract_recommendation(row.overall_feedback),
        )

    resume_summary = _summarize_resume(row.resume_screen)
    stage1_summary = _summarize_stage1(row.stage1_results)
    stage2_summary = _summarize_stage2(row.stage2_submission)
    stage3_summary = _summarize_stage3(row.stage3_answers)

    prompt = (
        f"You are a senior recruiter at {company_label} writing a debrief after a full mock interview loop.\n\n"
        f"Resume Screen (ATS):\n{resume_summary}\n\n"
        f"Stage 1 (Online Assessment):\n{stage1_summary}\n\n"
        f"Stage 2 (Technical Interview):\n{stage2_summary}\n\n"
        f"Stage 3 (Behavioral):\n{stage3_summary}\n\n"
        "Write a concise debrief (3-4 sentences): overall strengths, areas to improve, "
        "and end with a hiring recommendation from: STRONG HIRE / HIRE / BORDERLINE / NO HIRE. "
        "Base the recommendation on the interview performance (Stages 1 to 3); mention the resume "
        "screen only as context. Be direct and professional."
    )

    try:
        llm = LLMService()
        overall_feedback = await llm.call_kojo(prompt, provider=body.provider)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    hiring_recommendation = _extract_recommendation(overall_feedback)

    row.overall_feedback = overall_feedback
    row.status = STATUS_COMPLETE
    await db.commit()

    return FinishResponse(
        overall_feedback=overall_feedback,
        resume_verdict=resume_verdict,
        stage1_verdict=stage1_verdict,
        stage2_verdict=stage2_verdict,
        stage3_verdict=stage3_verdict,
        hiring_recommendation=hiring_recommendation,
    )


# ── List sessions ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[MockInterviewSessionResponse])
async def list_sessions(
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[MockInterviewSessionResponse]:
    rows = (
        await db.execute(
            select(MockInterviewSession)
            .where(MockInterviewSession.user_id == user.id)
            .order_by(MockInterviewSession.created_at.desc())
        )
    ).scalars().all()
    return [_to_response(r) for r in rows]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(row: MockInterviewSession) -> MockInterviewSessionResponse:
    return MockInterviewSessionResponse(
        id=row.id,
        company=row.company,
        stages_config=row.stages_config,
        status=row.status,
        resume_screen=row.resume_screen,
        stage1_results=row.stage1_results,
        stage2_script=row.stage2_script,
        stage2_submission=row.stage2_submission,
        stage3_script=row.stage3_script,
        stage3_answers=row.stage3_answers,
        overall_feedback=row.overall_feedback,
    )


def _summarize_resume(resume_screen_json: Optional[str]) -> str:
    if not resume_screen_json:
        return "Resume Screen was skipped or not completed."
    try:
        data = json.loads(resume_screen_json)
        score = data.get("ats_score", 0)
        passes = "would pass" if data.get("passes_oa") else "would NOT pass"
        return f"ATS score {score}/100, {passes} the screen. {data.get('summary', '')[:200]}"
    except Exception:
        return "Resume Screen result unavailable."


def _resume_overall_verdict(resume_screen_json: Optional[str]) -> Optional[str]:
    if not resume_screen_json:
        return None
    try:
        data = json.loads(resume_screen_json)
        score = int(data.get("ats_score", 0))
        if score >= 80:
            return "strong"
        if score >= 65 or data.get("passes_oa"):
            return "pass"
        if score >= 50:
            return "borderline"
        return "needs_work"
    except Exception:
        return None


def _summarize_stage1(stage1_results_json: Optional[str]) -> str:
    if not stage1_results_json:
        return "Stage 1 was skipped or not completed."
    try:
        results = json.loads(stage1_results_json)
        lines = []
        for r in results:
            lines.append(f"- {r['title']} ({r['difficulty']}): {r['verdict'].upper()}: {r['feedback'][:120]}")
        return "\n".join(lines) or "No results."
    except Exception:
        return "Stage 1 results unavailable."


def _summarize_stage2(stage2_submission_json: Optional[str]) -> str:
    if not stage2_submission_json:
        return "Stage 2 was skipped or not completed."
    try:
        data = json.loads(stage2_submission_json)
        return data.get("feedback", "No feedback recorded.")
    except Exception:
        return "Stage 2 feedback unavailable."


def _summarize_stage3(stage3_answers_json: Optional[str]) -> str:
    if not stage3_answers_json:
        return "Stage 3 was skipped or not completed."
    try:
        data = json.loads(stage3_answers_json)
        return data.get("feedback", "No feedback recorded.")
    except Exception:
        return "Stage 3 feedback unavailable."


def _stage1_overall_verdict(stage1_results_json: Optional[str]) -> Optional[str]:
    if not stage1_results_json:
        return None
    try:
        results = json.loads(stage1_results_json)
        verdicts = [r.get("verdict", "needs_work") for r in results]
        if all(v == "strong" for v in verdicts):
            return "strong"
        if sum(1 for v in verdicts if v in ("strong", "pass")) >= len(verdicts) / 2:
            return "pass"
        return "needs_work"
    except Exception:
        return None


def _stage2_overall_verdict(stage2_submission_json: Optional[str]) -> Optional[str]:
    if not stage2_submission_json:
        return None
    try:
        data = json.loads(stage2_submission_json)
        fb = data.get("feedback", "").lower()
        if any(w in fb for w in ("excellent", "strong", "optimal", "great")):
            return "strong"
        if any(w in fb for w in ("improvement", "consider", "could", "however")):
            return "pass"
        return "borderline"
    except Exception:
        return None


def _stage3_overall_verdict(stage3_answers_json: Optional[str]) -> Optional[str]:
    if not stage3_answers_json:
        return None
    try:
        data = json.loads(stage3_answers_json)
        fb = data.get("feedback", "").lower()
        if any(w in fb for w in ("strong", "excellent", "well-aligned", "aligned")):
            return "strong"
        if any(w in fb for w in ("improve", "weak", "vague", "lacks")):
            return "borderline"
        return "pass"
    except Exception:
        return None


def _extract_recommendation(feedback: str) -> str:
    upper = feedback.upper()
    for label in ("STRONG HIRE", "NO HIRE", "BORDERLINE", "HIRE"):
        if label in upper:
            return label
    return "BORDERLINE"
