from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
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
    Stage1GradeRequest,
    Stage1GradeResponse,
    Stage1QuestionResult,
    Stage2ChatRequest,
    Stage2ChatResponse,
    Stage2MessageRequest,
    Stage2MessageResponse,
    Stage2ScriptLine,
    Stage2ScriptRequest,
    Stage2ScriptResponse,
    Stage2SubmitRequest,
    Stage2SubmitResponse,
    Stage3AnswersRequest,
    Stage3AnswersResponse,
    Stage3MessageRequest,
    Stage3MessageResponse,
    Stage3Question,
    Stage3ScriptRequest,
    Stage3ScriptResponse,
)
from src.services.leetcode_service import LeetCodeService
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ResourceNotFoundException

router = APIRouter(prefix="/mock-interview", tags=["mock-interview"])

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
    stages = [s for s in body.stages if s in ("stage1", "stage2", "stage3")]
    if not stages:
        stages = ["stage1", "stage2", "stage3"]

    session = MockInterviewSession(
        user_id=user.id,
        company=body.company.lower(),
        stages_config=json.dumps(stages),
        status="pending",
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


# ── Stage 1: grade submissions ────────────────────────────────────────────────

@router.post("/{session_id}/stage1/grade", response_model=Stage1GradeResponse)
async def grade_stage1(
    session_id: int,
    body: Stage1GradeRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage1GradeResponse:
    row = await _load_session(session_id, user, db)

    svc = LeetCodeService()

    async def _grade_one(sub) -> Stage1QuestionResult:
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
        except Exception as exc:
            feedback = f"Grading unavailable: {exc}"

        verdict = _derive_verdict(sub.all_passed, feedback, sub.code)
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
    row.status = "stage1_complete"
    await db.commit()

    return Stage1GradeResponse(results=list(results))


def _derive_verdict(all_passed: bool, feedback: str, code: str) -> str:
    fb_lower = feedback.lower()
    if all_passed and any(w in fb_lower for w in ("correct", "excellent", "great", "optimal", "efficient", "well done")):
        return "strong"
    if all_passed:
        return "pass"
    if any(w in fb_lower for w in ("partial", "almost", "close", "minor", "small issue")):
        return "borderline"
    if not code.strip():
        return "needs_work"
    return "borderline" if len(code.strip()) > 50 else "needs_work"


# ── Stage 2: generate interviewer script ─────────────────────────────────────

@router.post("/{session_id}/stage2/script", response_model=Stage2ScriptResponse)
async def generate_stage2_script(
    session_id: int,
    body: Stage2ScriptRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage2ScriptResponse:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())
    candidate = _candidate_name(user)

    prompt = (
        f"You are simulating a technical phone-screen interview at {company_label}. "
        f"The candidate's name is {candidate}. "
        "Generate a realistic interviewer script for a 45-minute software engineering interview. "
        "The script must be structured as a JSON object with this exact shape:\n"
        "{\n"
        '  "script_lines": [\n'
        '    {"speaker": "interviewer", "text": "...", "is_coding_prompt": false},\n'
        '    ...\n'
        "  ],\n"
        '  "coding_slug": "two-sum",\n'
        '  "coding_title": "Two Sum",\n'
        '  "coding_difficulty": "Medium"\n'
        "}\n\n"
        "The script should include:\n"
        f"1. A warm intro (interviewer introduces themselves, greets {candidate} by name)\n"
        "2. 2-3 conceptual CS questions about data structures / algorithms / complexity\n"
        "3. ONE coding challenge — pick a real LeetCode Medium problem appropriate for "
        f"{company_label}. Set is_coding_prompt: true for the line where you present the problem, "
        "and put the full problem statement in that line's text field.\n"
        "4. A wrap-up / 'do you have questions for me?' closing\n\n"
        f"Use {candidate}'s name naturally throughout (not on every line). "
        "Use natural, conversational language. Keep each line under 3 sentences. "
        "Return ONLY the raw JSON — no markdown fences, no explanation."
    )

    try:
        llm = LLMService()
        raw = await llm.call_kojo(prompt, provider=body.provider)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = json.loads(raw)
    except (json.JSONDecodeError, LLMException) as exc:
        raise HTTPException(status_code=503, detail=f"Failed to generate interview script: {exc}") from exc

    script_lines = [Stage2ScriptLine(**line) for line in parsed.get("script_lines", [])]
    response = Stage2ScriptResponse(
        script_lines=script_lines,
        coding_slug=parsed.get("coding_slug"),
        coding_title=parsed.get("coding_title"),
        coding_difficulty=parsed.get("coding_difficulty"),
    )

    row.stage2_script = json.dumps(response.model_dump())
    row.status = "stage2"
    await db.commit()

    return response


# ── Stage 2: submit coding answer ─────────────────────────────────────────────

@router.post("/{session_id}/stage2/submit", response_model=Stage2SubmitResponse)
async def submit_stage2(
    session_id: int,
    body: Stage2SubmitRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage2SubmitResponse:
    row = await _load_session(session_id, user, db)

    script_data = json.loads(row.stage2_script) if row.stage2_script else {}
    coding_slug = script_data.get("coding_slug", "unknown")
    coding_title = script_data.get("coding_title", "the coding problem")
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
    row.status = "stage2_complete"
    await db.commit()

    return Stage2SubmitResponse(feedback=feedback)


# ── Stage 2: live chat during coding ─────────────────────────────────────────

@router.post("/{session_id}/stage2/chat", response_model=Stage2ChatResponse)
async def stage2_chat(
    session_id: int,
    body: Stage2ChatRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage2ChatResponse:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())
    candidate = _candidate_name(user)

    script_data = json.loads(row.stage2_script) if row.stage2_script else {}
    coding_title = script_data.get("coding_title", "the coding problem")
    problem_text = next(
        (line["text"] for line in script_data.get("script_lines", []) if line.get("is_coding_prompt")),
        "",
    )

    history_text = "\n".join(
        f"{candidate if m.role == 'user' else 'Interviewer'}: {m.text}"
        for m in body.history
    )

    prompt = (
        f"You are a senior software engineer at {company_label} conducting a live technical interview "
        f"with {candidate}.\n"
        f"You presented this coding problem:\n\n"
        f"Problem: {coding_title}\n{problem_text}\n\n"
        f"Conversation so far:\n{history_text}\n"
        f"{candidate}: {body.message}\n\n"
        f"Respond as the interviewer in 1-3 sentences. Use {candidate}'s name occasionally to keep it "
        "personal. Answer clarifying questions helpfully without giving away the solution. "
        "If they explain an approach, give brief feedback or ask a probing follow-up. "
        "Keep it natural and conversational."
    )

    try:
        llm = LLMService()
        reply = await llm.call_kojo(prompt, provider=body.provider)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return Stage2ChatResponse(reply=reply.strip())


# ── Stage 2: conversational interview ────────────────────────────────────────

@router.post("/{session_id}/stage2/message", response_model=Stage2MessageResponse)
async def stage2_message(
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
        "RESPOND WITH ONLY RAW JSON — no markdown fences, no extra text:\n"
        '{"reply": "...", "coding_problem": null, "is_done": false}\n\n'
        f"CURRENT USER TURN: {turn_count + 1}\n\n"
        "INTERVIEW PHASES (follow strictly based on turn count):\n"
        f"• Turns 1–3: Warm greeting, ask about {candidate}'s background (current role, relevant experience, why {company_label})\n"
        "• Turns 4–5: Ask 2 technical conceptual questions (time complexity, data structure tradeoffs, algorithm design)\n"
        f"• Turn 6: Present ONE {coding_difficulty} LeetCode problem — fill coding_problem field:\n"
        '  {"title":"Two Sum","slug":"two-sum","difficulty":"Medium","prompt":"Given an array..."}\n'
        "• Turns 7+: Discuss the problem, answer clarifying questions. coding_problem MUST be null.\n"
        "• After a user message starting with 'MY SOLUTION:': Give 2–3 sentence code review feedback. Set is_done: true.\n\n"
        "RULES:\n"
        "- reply: 2–4 sentences max. Be direct and conversational.\n"
        f"- Use {candidate}'s name occasionally (not every message).\n"
        "- coding_problem must only appear ONCE — null in all other turns.\n"
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

    row.status = "stage2"
    await db.commit()

    return Stage2MessageResponse(
        reply=parsed.get("reply", ""),
        coding_problem=coding_problem,
        is_done=bool(parsed.get("is_done", False)),
    )


# ── Stage 3: generate behavioral questions ────────────────────────────────────

@router.post("/{session_id}/stage3/script", response_model=Stage3ScriptResponse)
async def generate_stage3_script(
    session_id: int,
    body: Stage3ScriptRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage3ScriptResponse:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())

    company_culture_hints = {
        "google": "Googleyness & Leadership principles — focus on ambiguity, collaboration, impact at scale",
        "meta": "Move Fast culture — bias for action, ownership, building at scale, data-driven decisions",
        "amazon": "Amazon Leadership Principles (Customer Obsession, Ownership, Invent & Simplify, Deliver Results)",
        "apple": "craftsmanship, attention to detail, cross-functional teamwork, simplicity",
        "microsoft": "growth mindset, customer empathy, collaboration, inclusive leadership",
        "netflix": "Freedom & Responsibility culture — judgment, courage, transparency, impact",
    }
    culture_hint = company_culture_hints.get(row.company, "standard behavioral interview values")

    prompt = (
        f"You are a hiring manager at {company_label} conducting a behavioral interview. "
        f"The company culture focuses on: {culture_hint}.\n\n"
        "Generate a behavioral interview script as a JSON object:\n"
        "{\n"
        '  "opening": "Hi [Candidate], thanks for joining us today...",\n'
        '  "questions": [\n'
        '    {"index": 1, "question": "...", "follow_up": "..."},\n'
        "    ...\n"
        "  ]\n"
        "}\n\n"
        f"Include 5 behavioral questions tailored to {company_label}'s values. "
        "Each question should be a specific STAR-format prompt (Situation/Task/Action/Result). "
        "Include an optional follow-up question for each. "
        "Return ONLY the raw JSON — no markdown fences, no explanation."
    )

    try:
        llm = LLMService()
        raw = await llm.call_kojo(prompt, provider=body.provider)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = json.loads(raw)
    except (json.JSONDecodeError, LLMException) as exc:
        raise HTTPException(status_code=503, detail=f"Failed to generate behavioral questions: {exc}") from exc

    questions = [Stage3Question(**q) for q in parsed.get("questions", [])]
    response = Stage3ScriptResponse(
        questions=questions,
        opening=parsed.get("opening", f"Welcome to your {company_label} behavioral interview."),
    )

    row.stage3_script = json.dumps(response.model_dump())
    row.status = "stage3"
    await db.commit()

    return response


# ── Stage 3: submit answers ───────────────────────────────────────────────────

@router.post("/{session_id}/stage3/answers", response_model=Stage3AnswersResponse)
async def submit_stage3_answers(
    session_id: int,
    body: Stage3AnswersRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage3AnswersResponse:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())

    script_data = json.loads(row.stage3_script) if row.stage3_script else {}
    questions = script_data.get("questions", [])

    qa_pairs = []
    for i, q in enumerate(questions):
        answer = body.answers[i] if i < len(body.answers) else "(no answer provided)"
        qa_pairs.append(f"Q{i+1}: {q.get('question', '')}\nA: {answer}")

    qa_text = "\n\n".join(qa_pairs)
    prompt = (
        f"You are a {company_label} hiring manager reviewing a candidate's behavioral interview answers.\n\n"
        f"{qa_text}\n\n"
        "Provide 2-3 sentences of overall behavioral feedback: what was strong, what could be improved, "
        "and whether the answers align with the company's culture. Be direct and professional."
    )

    try:
        llm = LLMService()
        feedback = await llm.call_kojo(prompt, provider=body.provider)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    row.stage3_answers = json.dumps({"answers": body.answers, "feedback": feedback})
    row.status = "stage3_complete"
    await db.commit()

    return Stage3AnswersResponse(feedback=feedback)


# ── Stage 3: conversational behavioral interview ──────────────────────────────

_COMPANY_CULTURE = {
    "google": "Googleyness & Leadership — ambiguity tolerance, collaboration, impact at scale",
    "meta": "Move Fast — bias for action, ownership, data-driven decisions, building at scale",
    "amazon": "Leadership Principles — Customer Obsession, Ownership, Invent & Simplify, Deliver Results",
    "apple": "craftsmanship, attention to detail, simplicity, cross-functional teamwork",
    "microsoft": "growth mindset, customer empathy, collaboration, inclusive leadership",
    "netflix": "Freedom & Responsibility — judgment, courage, transparency, impact over process",
}


@router.post("/{session_id}/stage3/message", response_model=Stage3MessageResponse)
async def stage3_message(
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
        "RESPOND WITH ONLY RAW JSON — no markdown, no extra text:\n"
        '{"reply": "...", "is_done": false}\n\n'
        f"USER TURNS SO FAR: {turn_count}\n\n"
        "INTERVIEW FLOW:\n"
        f"• If turn_count == 0: Warm greeting + ask the FIRST behavioral STAR question tailored to {company_label}\n"
        "• After each answer: 1 sentence acknowledgment, then ask the NEXT question (one at a time)\n"
        f"• Cover 5 behavioral questions total focused on {company_label}'s culture above\n"
        "• After 5 user answers are given and acknowledged: wrap up warmly, set is_done: true\n\n"
        "RULES:\n"
        "- reply: 2–3 sentences max\n"
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
        row.status = "stage3"
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
        f"In 2–3 sentences, evaluate {candidate}'s overall behavioral responses: "
        "what was strong, what needs improvement, and whether they align with the company's culture. "
        "Be direct and professional."
    )
    try:
        llm = LLMService()
        feedback = await llm.call_kojo(eval_prompt, provider=provider)
    except Exception:
        feedback = "Behavioral evaluation unavailable."

    row.stage3_answers = json.dumps({"feedback": feedback.strip()})
    row.status = "stage3_complete"
    await db.commit()


# ── Finish: overall summary ───────────────────────────────────────────────────

@router.post("/{session_id}/finish", response_model=FinishResponse)
async def finish_interview(
    session_id: int,
    body: FinishRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FinishResponse:
    row = await _load_session(session_id, user, db)
    company_label = _COMPANY_LABELS.get(row.company, row.company.title())

    stage1_summary = _summarize_stage1(row.stage1_results)
    stage2_summary = _summarize_stage2(row.stage2_submission)
    stage3_summary = _summarize_stage3(row.stage3_answers)

    stage1_verdict = _stage1_overall_verdict(row.stage1_results)
    stage2_verdict = _stage2_overall_verdict(row.stage2_submission)
    stage3_verdict = _stage3_overall_verdict(row.stage3_answers)

    prompt = (
        f"You are a senior recruiter at {company_label} writing a debrief after a full mock interview loop.\n\n"
        f"Stage 1 (Online Assessment):\n{stage1_summary}\n\n"
        f"Stage 2 (Technical Interview):\n{stage2_summary}\n\n"
        f"Stage 3 (Behavioral):\n{stage3_summary}\n\n"
        "Write a concise debrief (3-4 sentences): overall strengths, areas to improve, "
        "and end with a hiring recommendation from: STRONG HIRE / HIRE / BORDERLINE / NO HIRE. "
        "Be direct and professional."
    )

    try:
        llm = LLMService()
        overall_feedback = await llm.call_kojo(prompt, provider=body.provider)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    hiring_recommendation = _extract_recommendation(overall_feedback)

    row.overall_feedback = overall_feedback
    row.status = "complete"
    await db.commit()

    return FinishResponse(
        overall_feedback=overall_feedback,
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
        stage1_results=row.stage1_results,
        stage2_script=row.stage2_script,
        stage2_submission=row.stage2_submission,
        stage3_script=row.stage3_script,
        stage3_answers=row.stage3_answers,
        overall_feedback=row.overall_feedback,
    )


def _summarize_stage1(stage1_results_json: Optional[str]) -> str:
    if not stage1_results_json:
        return "Stage 1 was skipped or not completed."
    try:
        results = json.loads(stage1_results_json)
        lines = []
        for r in results:
            lines.append(f"- {r['title']} ({r['difficulty']}): {r['verdict'].upper()} — {r['feedback'][:120]}")
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
