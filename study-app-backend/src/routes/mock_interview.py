import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
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
    JDParseRequest,
    JDParseResponse,
    MockCustomConfig,
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
from src.schemas.mock_interview_schema import _normalize_level
from src.services import lc_taxonomy
from src.limiter import limiter
from src.services.file_service import FileService
from src.services.leetcode_service import LeetCodeService
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ValidationException
from src.utils.provider_policy import resolve_request_provider

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

# Target seniority level drives coding difficulty distribution and how strict the
# interviewer is. The LeetCode problem bank is shared across levels; only the
# difficulty mix and the interviewer's expectations change. Read from one place so
# every prompt builder stays consistent.
_LEVEL_CONFIG = {
    "intern": {
        "label": "internship",
        "role": "software engineering intern",
        "coding_difficulty": "Easy/Medium",
        "rigor": (
            "Be encouraging and supportive. Value correct, clear thinking over optimal "
            "complexity. It is fine if the candidate needs hints; guide them. Do not expect "
            "a perfect big-O answer."
        ),
    },
    "junior": {
        "label": "new-grad / junior",
        "role": "junior software engineer",
        "coding_difficulty": "Medium",
        "rigor": (
            "Hold a standard new-grad bar. Expect a working solution and a basic complexity "
            "analysis. Offer a hint if they stall, but expect them to drive."
        ),
    },
    "mid": {
        "label": "mid-level",
        "role": "mid-level software engineer",
        "coding_difficulty": "Medium/Hard",
        "rigor": (
            "Be probing. Expect a near-optimal solution, explicit edge-case handling, and a "
            "tradeoff discussion. Push back on vague reasoning."
        ),
    },
    "senior": {
        "label": "senior",
        "role": "senior software engineer",
        "coding_difficulty": "Hard",
        "rigor": (
            "Be rigorous. Expect optimal time and space complexity, robustness and scale "
            "reasoning, and crisp communication. Probe deeply and do not accept hand-waving."
        ),
    },
}


def _level_config(row: MockInterviewSession) -> dict:
    """Resolve the level config for a session, defaulting to intern."""
    return _LEVEL_CONFIG.get(getattr(row, "level", "intern") or "intern", _LEVEL_CONFIG["intern"])


# Ordered interview goals for the conversational stages. The LLM is told to cover
# these one at a time and report which it has covered; the server enforces
# advancement and a hard turn cap so the interviewer cannot ramble indefinitely.
_STAGE2_GOALS = ["background", "concept_q1", "concept_q2", "coding_problem", "coding_discussion"]
_STAGE3_GOALS = ["behavioral_q1", "behavioral_q2", "behavioral_q3", "behavioral_q4", "behavioral_q5"]

# Hard turn caps (counted by user turns) so the stage always terminates even if the
# model never reports full goal coverage.
_STAGE2_TURN_CAP = 10
_STAGE3_TURN_CAP = 7


def _merge_covered_goals(prior: list[str], reported, valid_goals: list[str]) -> list[str]:
    """Union previously-covered goals with the model's new report, dropping any
    goal name that is not part of the known list (guards against hallucinated goals).
    Returned in canonical goal order."""
    covered = set(g for g in (prior or []) if g in valid_goals)
    if isinstance(reported, list):
        covered.update(g for g in reported if isinstance(g, str) and g in valid_goals)
    return [g for g in valid_goals if g in covered]


def _custom_config(row: MockInterviewSession) -> Optional[MockCustomConfig]:
    """Parse the stored custom-company JSON config, or None for built-in companies."""
    if row.company != "custom" or not row.custom_config:
        return None
    try:
        return MockCustomConfig.model_validate_json(row.custom_config)
    except Exception:
        return None


def _company_label(row: MockInterviewSession) -> str:
    """Display name: the pasted company for custom sessions, else the built-in label."""
    if row.company == "custom":
        return (row.custom_company or "the company").strip() or "the company"
    return _COMPANY_LABELS.get(row.company, row.company.title())


def _role_focus(row: MockInterviewSession) -> str:
    """What the company weighs (resume screen). JD-derived for custom sessions."""
    cfg = _custom_config(row)
    if cfg and cfg.role_focus.strip():
        return cfg.role_focus.strip()
    return _COMPANY_ROLE_FOCUS.get(row.company, "strong CS fundamentals and engineering impact")


def _culture_hint(row: MockInterviewSession) -> str:
    """Company culture (behavioral). JD-derived for custom sessions."""
    cfg = _custom_config(row)
    if cfg and cfg.culture.strip():
        return cfg.culture.strip()
    return _COMPANY_CULTURE.get(row.company, "performance, teamwork, and impact")


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

    company = body.company.lower()
    custom_company = None
    custom_config_json = None
    if company == "custom":
        custom_company = (body.custom_company or "").strip() or "the company"
        if body.custom_config is not None:
            custom_config_json = body.custom_config.model_dump_json()

    session = MockInterviewSession(
        user_id=user.id,
        company=company,
        level=body.level,
        custom_company=custom_company,
        jd_text=(body.jd_text or None) if company == "custom" else None,
        custom_config=custom_config_json,
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


# ── Parse a job description into a prefilled custom-company config ─────────────

@router.post("/parse-jd", response_model=JDParseResponse)
@limiter.limit("5/minute")
async def parse_job_description(
    request: Request,
    response: Response,
    body: JDParseRequest,
    user: User = Depends(get_current_user),
) -> JDParseResponse:
    # Constrain the model to real catalog topics: prefer the ids the client sent
    # (its live taxonomy), fall back to the backend's canonical set.
    menu = [t for t in body.available_topics if lc_taxonomy.canonical_topic(t)]
    menu_ids = sorted({lc_taxonomy.canonical_topic(t) for t in menu}) if menu else sorted(lc_taxonomy.TOPIC_IDS)

    jd = body.jd_text.strip()[:12000]
    prompt = (
        "You are a technical recruiter turning a software engineering job description into a "
        "mock-interview plan. Read the JD and infer what this company would test.\n\n"
        f"ALLOWED TOPIC IDS (choose suggested_topics ONLY from this exact list): {menu_ids}\n\n"
        "RESPOND WITH ONLY RAW JSON, no markdown fences, no extra text, in exactly this shape:\n"
        "{\n"
        '  "company_name": "the hiring company, or \\"the company\\" if not stated",\n'
        '  "role_focus": "one sentence on what this role/company weighs technically",\n'
        '  "culture": "one short phrase capturing the company values / culture",\n'
        '  "seniority": "one of: intern, junior, mid, senior",\n'
        '  "suggested_topics": ["3 to 6 topic ids from the allowed list most likely to be tested"]\n'
        "}\n\n"
        "Base seniority on the JD's titling and years of experience (intern/new-grad -> intern or "
        "junior, 3+ years -> mid, staff/lead/principal -> senior). Do not invent topic ids.\n\n"
        f"JOB DESCRIPTION:\n{jd}\n\nYour JSON response:"
    )

    try:
        llm = LLMService()
        raw = await llm.call_kojo(prompt, provider=resolve_request_provider(user, body.provider))
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
    except (json.JSONDecodeError, LLMException) as exc:
        raise HTTPException(status_code=503, detail=f"Failed to read the job description: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to read the job description: {exc}") from exc

    allowed = set(menu_ids)
    topics: list[str] = []
    for t in parsed.get("suggested_topics", []) if isinstance(parsed.get("suggested_topics"), list) else []:
        canon = lc_taxonomy.canonical_topic(str(t))
        if canon and canon in allowed and canon not in topics:
            topics.append(canon)

    return JDParseResponse(
        company_name=str(parsed.get("company_name", "")).strip()[:120] or "the company",
        role_focus=str(parsed.get("role_focus", "")).strip()[:600],
        culture=str(parsed.get("culture", "")).strip()[:600],
        seniority=_normalize_level(str(parsed.get("seniority", "intern"))),
        suggested_topics=topics[:6],
    )


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
    response: Response,
    session_id: int,
    resume_file: Optional[UploadFile] = File(default=None),
    resume_text: Optional[str] = Form(default=None),
    provider: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ResumeScreenResult:
    row = await _load_session(session_id, user, db)
    company_label = _company_label(row)
    role_focus = _role_focus(row)
    level_cfg = _level_config(row)

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
        f"first resume screen for a {level_cfg['role']} ({level_cfg['label']}) role at {company_label}. "
        f"This company weighs: {role_focus}.\n\n"
        f"Calibrate expectations to a {level_cfg['label']} candidate: {level_cfg['rigor']}\n\n"
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
        raw = await llm.call_kojo(prompt, provider=resolve_request_provider(user, provider))
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
    response: Response,
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
                provider=resolve_request_provider(user, body.provider),
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
    response: Response,
    session_id: int,
    body: Stage2SubmitRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage2SubmitResponse:
    row = await _load_session(session_id, user, db)

    coding_slug = body.problem_slug or "unknown"
    coding_title = body.problem_title or "the coding problem"
    company_label = _company_label(row)
    candidate = _candidate_name(user)
    level_cfg = _level_config(row)

    prompt = (
        f"You are a {level_cfg['role']} interviewer at {company_label} reviewing {candidate}'s solution "
        f"for a {level_cfg['label']} candidate.\n"
        f"Problem: {coding_title} ({coding_slug})\n\n"
        f"{candidate}'s code:\n```python\n{body.code}\n```\n\n"
        f"Calibrate your expectations to a {level_cfg['label']} candidate: {level_cfg['rigor']}\n"
        f"Provide brief interview-style feedback (3-4 sentences) addressed directly to {candidate}: "
        "correctness, approach quality, time/space complexity, and one improvement suggestion. "
        "Be professional and constructive."
    )

    try:
        llm = LLMService()
        feedback = await llm.call_kojo(prompt, provider=resolve_request_provider(user, body.provider))
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
    response: Response,
    session_id: int,
    body: Stage2MessageRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage2MessageResponse:
    row = await _load_session(session_id, user, db)
    company_label = _company_label(row)
    candidate = _candidate_name(user)
    level_cfg = _level_config(row)

    turn_count = sum(1 for m in body.history if m.role == "user")

    history_text = "\n".join(
        f"{'You (Interviewer)' if m.role == 'interviewer' else candidate}: {m.content}"
        for m in body.history
    )

    # For a custom company the candidate chose the difficulties (and maybe specific
    # problems / focus topics); those override the level-derived difficulty for the
    # coding problem the interviewer presents.
    cfg = _custom_config(row)
    coding_difficulty = level_cfg["coding_difficulty"]
    custom_focus = ""
    if cfg:
        if cfg.difficulties:
            coding_difficulty = "/".join(cfg.difficulties)
        if cfg.problems:
            picks = ", ".join(f"{p.title or p.slug} ({p.slug})" for p in cfg.problems[:6])
            custom_focus = (
                f"\nWhen you present the coding problem, choose ONE from the candidate's target "
                f"problem set: {picks}. Use its real title and slug.\n"
            )
        elif cfg.topics:
            custom_focus = (
                f"\nFocus the technical and coding questions on these topics this company tests: "
                f"{', '.join(cfg.topics)}.\n"
            )
        if cfg.subtopics:
            custom_focus += (
                f"Emphasize these specific techniques where they fit naturally: "
                f"{', '.join(cfg.subtopics)}.\n"
            )

    # Goal tracking: the client echoes back the goals covered so far. We tell the
    # model which goal to focus on next so it does not loop or wander.
    covered = _merge_covered_goals(body.covered_goals, [], _STAGE2_GOALS)
    remaining = [g for g in _STAGE2_GOALS if g not in covered]
    current_goal = remaining[0] if remaining else "coding_discussion"
    # Once the candidate has been talking for a while without reaching the coding
    # problem, force it so the interviewer stops chatting and gets to the code.
    force_coding = "coding_problem" not in covered and turn_count >= 4

    goal_descriptions = {
        "background": f"greet warmly and ask about {candidate}'s background (role, relevant experience, why {company_label})",
        "concept_q1": "ask ONE technical conceptual question (time complexity, data structure tradeoffs, or algorithm design)",
        "concept_q2": "ask a SECOND, different technical conceptual question",
        "coding_problem": f"present ONE {coding_difficulty} LeetCode problem by filling the coding_problem field",
        "coding_discussion": "discuss the coding problem and answer clarifying questions without giving away the full solution",
    }
    if force_coding:
        current_goal = "coding_problem"

    system_prompt = (
        f"You are a {level_cfg['role']} at {company_label} conducting a 45-minute technical phone "
        f"screen with {candidate} for a {level_cfg['label']} role.\n"
        f"Calibrate difficulty and expectations to a {level_cfg['label']} candidate: {level_cfg['rigor']}\n"
        f"{custom_focus}"
        "RESPOND WITH ONLY RAW JSON, no markdown fences, no extra text:\n"
        '{"reply": "...", "coding_problem": null, "covered_goals": ["..."], "is_done": false}\n\n'
        "YOUR INTERVIEW GOALS, IN ORDER (cover each ONE at a time):\n"
        + "".join(f"- {g}: {goal_descriptions[g]}\n" for g in _STAGE2_GOALS)
        + "\n"
        f"GOALS ALREADY COVERED: {covered or ['(none yet)']}\n"
        f"YOUR SINGLE GOAL FOR THIS TURN: {current_goal} ({goal_descriptions[current_goal]})\n\n"
        "RULES:\n"
        "- Address ONLY the current goal this turn. Once the candidate has answered it, add it to "
        "covered_goals and move to the next goal. Do NOT re-ask a goal that is already covered.\n"
        "- Ask a follow-up ONLY to clarify an incomplete or unclear answer. If the candidate asks YOU "
        "a question, answer it briefly, then return to the current goal. Never invent new goals.\n"
        "- When the current goal is coding_problem, fill the coding_problem field like:\n"
        f'  {{"title":"Two Sum","slug":"two-sum","difficulty":"{coding_difficulty.split("/")[0]}","prompt":"Given an array..."}}\n'
        "  and include \"coding_problem\" in covered_goals. In all other turns coding_problem MUST be null.\n"
        "- covered_goals: list every goal covered so far (including ones from earlier turns).\n"
        "- reply: 2 to 4 sentences max. Be direct and conversational.\n"
        f"- Use {candidate}'s name occasionally (not every message).\n"
        "- The candidate submits their code with a separate button, so always keep is_done false.\n"
        "- Return ONLY raw JSON.\n"
    )
    if force_coding:
        system_prompt += (
            "\nIMPORTANT: The background and concept questions have taken long enough. Present the "
            "coding problem THIS turn regardless of what else is pending.\n"
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
        raw = await llm.call_kojo(full_prompt, provider=resolve_request_provider(user, body.provider))
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
    except Exception:
        fallback = raw if isinstance(raw, str) and raw else "I see, thanks for sharing that. Let's continue."
        return Stage2MessageResponse(reply=fallback[:600], covered_goals=covered)

    coding_problem = None
    if parsed.get("coding_problem"):
        cp = parsed["coding_problem"]
        coding_problem = CodingProblemInfo(
            title=cp.get("title", "Coding Problem"),
            slug=cp.get("slug", "problem"),
            difficulty=cp.get("difficulty", coding_difficulty.split("/")[0]),
            prompt=cp.get("prompt", ""),
        )

    # Merge the model's report with what was already covered. If a coding problem
    # was presented this turn, count that goal as covered regardless of the report.
    updated_covered = _merge_covered_goals(covered, parsed.get("covered_goals"), _STAGE2_GOALS)
    if coding_problem is not None and "coding_problem" not in updated_covered:
        updated_covered = _merge_covered_goals(updated_covered, ["coding_problem"], _STAGE2_GOALS)

    row.status = STATUS_STAGE2
    await db.commit()

    return Stage2MessageResponse(
        reply=parsed.get("reply", ""),
        coding_problem=coding_problem,
        is_done=False,
        covered_goals=updated_covered,
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
    response: Response,
    session_id: int,
    body: Stage3MessageRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage3MessageResponse:
    row = await _load_session(session_id, user, db)
    provider = resolve_request_provider(user, body.provider)
    company_label = _company_label(row)
    candidate = _candidate_name(user)
    culture_hint = _culture_hint(row)
    level_cfg = _level_config(row)

    turn_count = sum(1 for m in body.history if m.role == "user")

    history_text = "\n".join(
        f"{'You (Interviewer)' if m.role == 'interviewer' else candidate}: {m.content}"
        for m in body.history
    )

    # Goal tracking: five behavioral questions, one per goal. The client echoes the
    # goals covered so far; the server enforces advancement and a hard turn cap.
    covered = _merge_covered_goals(body.covered_goals, [], _STAGE3_GOALS)
    remaining = [g for g in _STAGE3_GOALS if g not in covered]
    question_number = len(covered) + 1  # the behavioral question to ask this turn

    system_prompt = (
        f"You are a hiring manager at {company_label} conducting a 30-minute behavioral interview with "
        f"{candidate} for a {level_cfg['label']} role.\n"
        f"Company culture: {culture_hint}\n"
        f"Calibrate depth to a {level_cfg['label']} candidate: {level_cfg['rigor']}\n\n"
        "RESPOND WITH ONLY RAW JSON, no markdown, no extra text:\n"
        '{"reply": "...", "covered_goals": ["..."], "is_done": false}\n\n'
        f"YOUR GOALS: ask exactly 5 behavioral STAR questions, one per turn, tracked as "
        f"{_STAGE3_GOALS}.\n"
        f"GOALS ALREADY COVERED: {covered or ['(none yet)']}\n"
        f"THIS TURN: ask behavioral question number {question_number} of 5, tailored to "
        f"{company_label}'s culture above (or wrap up if all 5 are already covered).\n\n"
        "RULES:\n"
        "- Give a 1 sentence acknowledgment of the previous answer, then ask the NEXT uncovered "
        "question. Ask ONE question per turn. Do NOT re-ask a question already covered.\n"
        "- Ask a follow-up ONLY to clarify an unclear answer. If the candidate asks YOU a question, "
        "answer briefly, then continue with the current question. Never add questions beyond the 5.\n"
        "- covered_goals: list every behavioral question slot answered so far (from the list above).\n"
        "- After all 5 answers are given and acknowledged: wrap up warmly and set is_done: true.\n"
        "- reply: 2 to 3 sentences max. Ask ONE question per turn.\n"
        f"- Use {candidate}'s name occasionally. Be warm but professional.\n"
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
        raw = await llm.call_kojo(full_prompt, provider=provider)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
    except Exception:
        fallback = raw if isinstance(raw, str) and raw else "Thank you for sharing. Could you tell me more?"
        return Stage3MessageResponse(reply=fallback[:600], covered_goals=covered)

    # Merge coverage. A user answer this turn advances one behavioral goal even if the
    # model forgets to report it, so coverage cannot stall.
    updated_covered = _merge_covered_goals(covered, parsed.get("covered_goals"), _STAGE3_GOALS)
    if body.message is not None and len(updated_covered) <= len(covered):
        next_goal = next((g for g in _STAGE3_GOALS if g not in updated_covered), None)
        if next_goal:
            updated_covered = _merge_covered_goals(updated_covered, [next_goal], _STAGE3_GOALS)

    # The stage ends when the model says so, when all 5 questions are covered, or when
    # the hard turn cap is hit, so the interviewer can never ramble past the budget.
    is_done = bool(parsed.get("is_done", False))
    if len(updated_covered) >= len(_STAGE3_GOALS) or turn_count + 1 >= _STAGE3_TURN_CAP:
        is_done = True

    if is_done and body.message is not None:
        # Save conversation as stage3 feedback for the final summary
        await _save_stage3_conversation_feedback(
            row=row,
            history=body.history + [InterviewChatMessage(role="user", content=body.message)],
            company_label=company_label,
            candidate=candidate,
            db=db,
            provider=provider,
        )
    else:
        row.status = STATUS_STAGE3
        await db.commit()

    return Stage3MessageResponse(
        reply=parsed.get("reply", ""),
        is_done=is_done,
        covered_goals=updated_covered,
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
    response: Response,
    session_id: int,
    body: FinishRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FinishResponse:
    row = await _load_session(session_id, user, db)
    company_label = _company_label(row)
    level_cfg = _level_config(row)

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
        f"You are a senior recruiter at {company_label} writing a debrief after a full mock interview "
        f"loop for a {level_cfg['label']} candidate.\n"
        f"Judge against the {level_cfg['label']} bar: {level_cfg['rigor']}\n\n"
        f"Resume Screen (ATS):\n{resume_summary}\n\n"
        f"Stage 1 (Online Assessment):\n{stage1_summary}\n\n"
        f"Stage 2 (Technical Interview):\n{stage2_summary}\n\n"
        f"Stage 3 (Behavioral):\n{stage3_summary}\n\n"
        "Write a concise debrief (3-4 sentences): overall strengths, areas to improve, "
        "and end with a hiring recommendation from: STRONG HIRE / HIRE / BORDERLINE / NO HIRE. "
        f"Base the recommendation on the interview performance (Stages 1 to 3) against the "
        f"{level_cfg['label']} bar; mention the resume screen only as context. Be direct and professional."
    )

    try:
        llm = LLMService()
        overall_feedback = await llm.call_kojo(prompt, provider=resolve_request_provider(user, body.provider))
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
        level=row.level,
        custom_company=row.custom_company,
        jd_text=row.jd_text,
        custom_config=_custom_config(row),
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
