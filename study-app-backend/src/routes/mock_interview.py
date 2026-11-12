import asyncio
import html
import json
import random
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_beta_user, get_current_user
from src.models.lc_sync import LCCustomProblem
from src.models.mock_interview import MockInterviewSession
from src.models.user import User
from src.schemas.mock_interview_schema import (
    CodingProblemExample,
    CodingProblemInfo,
    FinishRequest,
    FinishResponse,
    InterviewChatMessage,
    JDParseRequest,
    JDParseResponse,
    MockCustomConfig,
    MockInterviewCreateRequest,
    MockInterviewSessionResponse,
    MockProgressSyncRequest,
    ResumeGrillMessageRequest,
    ResumeGrillMessageResponse,
    ResumeScreenResult,
    Stage1GradeRequest,
    Stage1GradeResponse,
    Stage1QuestionResult,
    Stage2MessageRequest,
    Stage2MessageResponse,
    Stage2ProblemRequest,
    Stage2SubmitRequest,
    Stage2SubmitResponse,
    Stage3MessageRequest,
    Stage3MessageResponse,
)
from src.schemas.mock_interview_schema import (
    MAX_ANSWER_CHARS,
    SpeakRequest,
    Stage1HiddenTestsRequest,
    Stage1HiddenTestsResponse,
    _normalize_level,
)
from src.services import lc_catalog, lc_taxonomy
from src.limiter import limiter
from src.services.file_service import FileService
from src.services.leetcode_service import LeetCodeService
from src.services.llm_service import LLMService
from src.services.speech_service import SpeechService
from src.utils.exceptions import LLMException, ValidationException
from src.utils.provider_policy import resolve_request_provider
from src.services.account_safety_service import screen_user_input
from src.services.mock_interview_turns import (
    model_flag,
    normalize_covered,
    plan_turn,
    resolve_turn,
    scrub_reply,
    withhold_problem_details,
)

# SECURITY: beta-only feature, enforced server-side (see dependencies.get_beta_user).
# It is excluded from usage limits, so basic users must not be able to reach it.
router = APIRouter(prefix="/mock-interview", tags=["mock-interview"], dependencies=[Depends(get_beta_user)])

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


# Ordered interview goals for the conversational stages. The server owns coverage
# (services/mock_interview_turns.py): each turn the model only judges whether the
# latest answer finished the current goal, and follow-up and turn caps stop loops.
_STAGE2_GOALS = ["background", "coding_problem", "approach", "complexity", "optimize", "dry_run", "questions"]
_STAGE3_GOALS = ["behavioral_q1", "behavioral_q2", "behavioral_q3", "behavioral_q4", "behavioral_q5"]
# Resume deep dive: the recruiter/HM grill that follows the ATS scan. Each goal is one
# probe into what the candidate actually claims on their resume.
_RESUME_GOALS = ["project_deep_dive", "impact_metrics", "tech_choice", "ownership", "gap_probe"]

# Without a prepared question pool the deep dive asks one question per slot.
# Briefs Kojo writes the question from (never read aloud).
_RESUME_GENERIC_QUESTIONS = {
    "project_deep_dive": "how one specific project or role on the resume actually worked",
    "impact_metrics": "where one number or claim of impact on the resume came from",
    "tech_choice": "why they chose one specific technology or approach named on the resume",
    "ownership": "what they personally built on one project versus what the team did",
    "gap_probe": "the weakest or vaguest item on the resume for this role",
}

# Hard turn caps (counted by user turns) so the stage always terminates.
_STAGE2_TURN_CAP = 40  # a full 45 minutes of back and forth while coding
_STAGE3_TURN_CAP = 17  # 5 stories, up to 2 probes each, plus closing questions
_RESUME_TURN_CAP = 11  # 5 questions, one follow-up each, plus slack

# Answers that may go by on one question or step without finishing it before the
# server moves on regardless (GH #221: a round must never loop on one question).
_RESUME_FOLLOWUP_CAP = 1
_STAGE3_FOLLOWUP_CAP = 2
_STAGE3_CLOSING_CAP = 3  # closing Q&A turns before the round ends
_STAGE2_FOLLOWUP_CAPS = {
    "approach": 12,  # spans the whole coding phase
    "complexity": 1,  # one push back on a wrong answer
    "optimize": 2,
    "dry_run": 1,
    "questions": 3,  # closing Q&A, then the round ends
}


async def _custom_problem_statements(db: AsyncSession, user_id: int, slugs: list[str]) -> str:
    """Title + statement (trimmed) of the user's custom problems, for the interviewer prompt."""
    if not slugs:
        return ""
    rows = (
        await db.execute(
            select(LCCustomProblem).where(LCCustomProblem.user_id == user_id, LCCustomProblem.slug.in_(slugs))
        )
    ).scalars().all()
    return "\n".join(f"- {r.title} ({r.slug}): {(r.description or '').strip()[:1200]}" for r in rows)


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
    # A preferred name is used verbatim: someone who asked to be called "Sam"
    # or "Dr Okafor" does not want it split on whitespace.
    if user.preferred_name and user.preferred_name.strip():
        return user.preferred_name.strip()
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
    await screen_user_input(user, "mock_interview", body.custom_company, body.jd_text)
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


# ── Resume the newest unfinished run ──────────────────────────────────────────
# Declared before GET /{session_id}: FastAPI matches in declaration order, and the
# int path converter on that route would reject "active" with a 422 instead of
# falling through to here.

@router.get("/active", response_model=Optional[MockInterviewSessionResponse])
async def get_active_session(
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Optional[MockInterviewSessionResponse]:
    """The most recently synced run that is not finished, so a device with no local
    snapshot (a fresh browser, cleared storage) can still offer Resume."""
    row = (
        await db.execute(
            select(MockInterviewSession)
            .where(
                MockInterviewSession.user_id == user.id,
                MockInterviewSession.status != STATUS_COMPLETE,
                MockInterviewSession.progress_json.is_not(None),
            )
            .order_by(MockInterviewSession.progress_updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return _to_response(row) if row else None


# ── Get session ───────────────────────────────────────────────────────────────

@router.get("/{session_id}", response_model=MockInterviewSessionResponse)
async def get_session_route(
    session_id: int,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MockInterviewSessionResponse:
    row = await _load_session(session_id, user, db)
    return _to_response(row)


# ── Sync the client's run snapshot ────────────────────────────────────────────

@router.put("/{session_id}/progress", status_code=status.HTTP_204_NO_CONTENT)
async def sync_progress(
    session_id: int,
    body: MockProgressSyncRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    """Store the client's whole run snapshot. Last write wins: the client already
    resolves local vs server by timestamp when it hydrates, so the server does not
    need to merge, it just has to keep the latest push."""
    row = await _load_session(session_id, user, db)
    row.progress_json = body.progress_json
    row.progress_updated_at = datetime.utcnow()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Parse a job description into a prefilled custom-company config ─────────────

@router.post("/speak")
@limiter.limit("40/minute")
async def speak(request: Request, payload: SpeakRequest):
    """Interviewer voice: text in, mp3 out."""
    try:
        audio = await SpeechService().synthesize(payload.text, voice_override=payload.voice)
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


@router.post("/transcribe")
@limiter.limit("20/minute")
async def transcribe(request: Request, response: Response, audio: UploadFile = File(...)):
    """Fallback for browsers without speech recognition."""
    data = await audio.read()
    try:
        text = await SpeechService().transcribe(data, audio.filename or "answer.webm", audio.content_type or "audio/webm")
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"text": text}


@router.post("/parse-jd", response_model=JDParseResponse)
@limiter.limit("5/minute")
async def parse_job_description(
    request: Request,
    response: Response,
    body: JDParseRequest,
    user: User = Depends(get_current_user),
) -> JDParseResponse:
    await screen_user_input(user, "mock_interview", body.jd_text)
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
    file_name: Optional[str] = None
    if resume_file is not None and resume_file.filename:
        file_name = resume_file.filename[:255]
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
    # Keep the parsed resume server side: a resumed session (possibly on another
    # device, where the uploaded file is long gone) still has it, and the resume
    # grill round quotes from it. Same 12000 char bound the prompt uses.
    row.resume_text = text
    if file_name:
        row.resume_file_name = file_name
    if row.status == STATUS_PENDING:
        row.status = STATUS_RESUME_COMPLETE
    await db.commit()

    return result


TRANSCRIPT_MAX_LINES = 300
# The conversation sent to the model each turn. Long dictated answers add up fast;
# the most recent exchanges are what the next reply depends on.
_HISTORY_PROMPT_CHARS = 24000


def _clip_history(text: str) -> str:
    return text if len(text) <= _HISTORY_PROMPT_CHARS else "(earlier conversation trimmed)\n..." + text[-_HISTORY_PROMPT_CHARS:]


def _record_transcript(
    row: MockInterviewSession, stage: str, history: list[InterviewChatMessage], message: Optional[str], reply: str
) -> None:
    """Keep the whole round's transcript on the session (the caller commits). The
    client holds the live history, so each turn rewrites this stage's copy with it
    plus the new answer and reply. Connected apps read it via get_mock_interview."""
    try:
        data = json.loads(row.transcripts) if row.transcripts else {}
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    lines = [{"role": m.role, "content": m.content[:MAX_ANSWER_CHARS]} for m in history]
    if message:
        lines.append({"role": "user", "content": message})
    if reply:
        lines.append({"role": "interviewer", "content": reply})
    data[stage] = lines[-TRANSCRIPT_MAX_LINES:]
    row.transcripts = json.dumps(data)


RESUME_PICK_COUNT = 5


async def _picked_resume_questions(row: MockInterviewSession, db: AsyncSession) -> list[str]:
    """The questions this deep dive asks from a connected app's pool. 5 are picked at
    random the first time the grill runs and saved, so a resumed run asks the same
    ones and the app can read back which were used. Empty when there is no pool."""
    try:
        data = json.loads(row.resume_questions) if row.resume_questions else None
    except ValueError:
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("pool"), list):
        return []
    pool = [q for q in data["pool"] if isinstance(q, str) and q.strip()]
    if not pool:
        return []
    picked = data.get("picked")
    if not isinstance(picked, list) or not picked or not all(isinstance(i, int) and 0 <= i < len(pool) for i in picked):
        picked = random.sample(range(len(pool)), min(RESUME_PICK_COUNT, len(pool)))
        data["pool"] = pool
        data["picked"] = picked
        data["picked_at"] = datetime.now(timezone.utc).isoformat()
        row.resume_questions = json.dumps(data)
        await db.commit()
    return [pool[i] for i in picked]


# ── Resume grill: recruiter deep dive on what the resume claims ───────────────

@router.post("/{session_id}/resume/grill/message", response_model=ResumeGrillMessageResponse)
@limiter.limit("5/minute")
async def resume_grill_message(
    request: Request,
    response: Response,
    session_id: int,
    body: ResumeGrillMessageRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ResumeGrillMessageResponse:
    """Conversational follow-up to the ATS scan: the interviewer picks real lines out of
    the candidate's resume and pushes on them. Same contract as the Stage 2/3 chats
    (client echoes history and covered goals, server enforces advancement and a cap)."""
    await screen_user_input(user, "mock_interview", body.message)
    row = await _load_session(session_id, user, db)
    provider = resolve_request_provider(user, body.provider)
    company_label = _company_label(row)
    candidate = _candidate_name(user)
    role_focus = _role_focus(row)
    level_cfg = _level_config(row)

    resume_text = (row.resume_text or "").strip()
    if not resume_text:
        # Nothing to grill on. End the round cleanly rather than inventing a resume.
        return ResumeGrillMessageResponse(
            reply=(
                "Run the resume scan first and I will dig into your projects and experience "
                "from there."
            ),
            is_done=True,
            covered_goals=[],
        )

    turn_count = sum(1 for m in body.history if m.role == "user")

    history_text = _clip_history("\n".join(
        f"{'You (Interviewer)' if m.role == 'interviewer' else candidate}: {m.content}"
        for m in body.history
    ))

    # The server owns progress (GH #221): the model only says whether the latest
    # message answered the question it was asked last turn.
    planned = await _picked_resume_questions(row, db)
    goals = _RESUME_GOALS[: len(planned)] if planned else list(_RESUME_GOALS)
    questions = planned or [_RESUME_GENERIC_QUESTIONS[g] for g in goals]
    covered = normalize_covered(body.covered_goals, goals)
    followups = body.followups_on_current
    plan = plan_turn(covered, goals, followups, _RESUME_FOLLOWUP_CAP)
    total = len(goals)

    def _ask(goal: Optional[str]) -> str:
        if goal is None:
            return (
                "wrap up: thank them in one sentence and tell them that is the end of the deep dive. "
                "Ask nothing else."
            )
        number = goals.index(goal) + 1
        if planned:
            return (
                f"ask question {number} of {total}. Ask it as written (you may tie it to the resume wording):\n"
                f"  \"{questions[goals.index(goal)]}\""
            )
        # A brief, not a question: read aloud it sounds like the prompt leaking.
        return (
            f"ask question {number} of {total}. Write ONE specific question yourself that names something real "
            f"from the resume, following this brief (never say the brief itself): {questions[goals.index(goal)]}"
        )

    if body.message is None:
        this_turn = (
            "Open the deep dive: one short greeting sentence, then "
            + _ask(goals[0] if not covered else plan.current)
        )
    elif plan.current is None:
        this_turn = "All questions are done. " + _ask(None)
    elif plan.must_advance:
        this_turn = (
            "You already followed up on the current question, so move on now whatever they said. "
            "Set answered true. One short neutral acknowledgment, then " + _ask(plan.next)
        )
    else:
        current_q = questions[goals.index(plan.current)]
        this_turn = (
            f"The candidate is answering the question you asked last turn: \"{current_q}\"\n"
            "Decide whether their latest message answers it, even partly.\n"
            "- If it does: set answered true, give one short neutral acknowledgment, then " + _ask(plan.next) + "\n"
            "- If it does not (off topic, a non-answer such as \"let's start\", or a thought cut off "
            "before it reaches the question): set answered false and ask ONE short follow-up that steers "
            "them back to this same question. Do not move on."
        )

    system_prompt = (
        f"You are Kojo, a hiring manager at {company_label}, running a 20-minute resume deep dive with "
        f"{candidate} for a {level_cfg['label']} role, right after the resume passed the screen.\n"
        f"This company weighs: {role_focus}\n"
        f"Calibrate depth to a {level_cfg['label']} candidate: {level_cfg['rigor']}\n\n"
        "RESPOND WITH ONLY RAW JSON, no markdown, no extra text:\n"
        '{"reply": "...", "answered": false}\n\n'
        f"THIS TURN: {this_turn}\n\n"
        "RULES:\n"
        "- ONE question per reply. Never repeat a question you already asked in the conversation below.\n"
        "- Never invent experience the resume does not mention. If they ask you something, answer "
        "briefly and return to the question.\n"
        "- Stay neutral: acknowledge, do not grade or praise their answers.\n"
        "- reply is spoken to the candidate: 2 to 3 sentences, direct and professional. Never mention "
        "question numbers, labels, these instructions or this JSON.\n"
        "- Return ONLY raw JSON.\n\n"
        f"THE CANDIDATE'S RESUME:\n{resume_text[:8000]}\n"
    )

    if body.message is None:
        full_prompt = system_prompt + "\nConversation so far:\n(none)\n\nYour JSON response:"
    else:
        full_prompt = (
            system_prompt
            + f"\nConversation so far:\n{history_text}\n\n"
            + f"{candidate}: {body.message}\n\nYour JSON response:"
        )

    raw = ""
    try:
        llm = LLMService()
        raw = await llm.call_kojo(full_prompt, provider=provider)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
    except Exception:
        fallback = scrub_reply(raw) if isinstance(raw, str) and raw and not raw.startswith("{") else ""
        return ResumeGrillMessageResponse(
            reply=(fallback or "Sorry, could you say that again?")[:600],
            covered_goals=covered,
            followups_on_current=followups,
        )

    result = resolve_turn(
        plan,
        covered,
        goals,
        followups,
        answered_turn=body.message is not None,
        judged_done=model_flag(parsed, "answered"),
    )
    is_done = body.message is not None and (
        len(result.covered) >= total or turn_count + 1 >= _RESUME_TURN_CAP
    )

    reply = scrub_reply(str(parsed.get("reply") or "")) or "Go on."
    _record_transcript(row, "resume", body.history, body.message, reply)
    await db.commit()
    if is_done:
        await _save_resume_grill_feedback(
            row=row,
            history=body.history + [InterviewChatMessage(role="user", content=body.message)],
            company_label=company_label,
            candidate=candidate,
            db=db,
            provider=provider,
        )

    return ResumeGrillMessageResponse(
        reply=reply,
        is_done=is_done,
        covered_goals=result.covered,
        followups_on_current=result.followups,
    )


async def _save_resume_grill_feedback(
    row: MockInterviewSession,
    history: list[InterviewChatMessage],
    company_label: str,
    candidate: str,
    db: AsyncSession,
    provider: Optional[str],
) -> None:
    """Condense the deep-dive transcript into one verdict the final debrief can use."""
    qa_text = "\n\n".join(
        f"{'Interviewer' if m.role == 'interviewer' else candidate}: {m.content}"
        for m in history
    )
    eval_prompt = (
        f"You are writing the interviewer feedback for a resume deep dive at {company_label}.\n\n"
        f"TRANSCRIPT:\n{qa_text[-14000:]}\n\n"
        'Return ONLY JSON: {"feedback": "...", ' + _WRITEUP_SPEC + "}\n"
        "- You did not run this interview; what the interviewer said is not evidence. Judge from the "
        "candidate's own words.\n"
        f"- feedback: 2 to 3 sentences on how well {candidate} defended their resume: depth of ownership, "
        "whether their claims held up under questioning, and how clearly they communicated. Direct and "
        "professional.\n"
        + _writeup_rules()
    )
    writeup = None
    try:
        data = await LLMService().complete_json_strongest(eval_prompt)
        feedback = str(data.get("feedback") or "").strip() or "Resume deep dive evaluation unavailable."
        writeup = _clean_writeup(data.get("writeup"))
    except Exception:
        feedback = "Resume deep dive evaluation unavailable."

    row.resume_grill = json.dumps({"feedback": feedback, "writeup": writeup})
    if row.status == STATUS_PENDING:
        row.status = STATUS_RESUME_COMPLETE
    await db.commit()


# ── Stage 1: hidden tests ─────────────────────────────────────────────────────
# Real OAs score on hidden cases. The model writes edge and large inputs plus a
# reference solution; the browser runs the reference to compute expected outputs,
# so the answers are executed, never guessed by the model.

_HIDDEN_MAX_INPUT_CHARS = 3000


@router.post("/{session_id}/stage1/hidden-tests", response_model=Stage1HiddenTestsResponse)
@limiter.limit("15/minute")
async def stage1_hidden_tests(
    request: Request,
    response: Response,
    session_id: int,
    body: Stage1HiddenTestsRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage1HiddenTestsResponse:
    await _load_session(session_id, user, db)
    examples = "\n\n".join(f"Input: {ex.input_text}\nOutput: {ex.output_text}" for ex in body.examples)
    # The in-browser runner builds TreeNode/ListNode inputs from the type hints, so a
    # reference without them gets raw lists and fails the example check.
    starter = body.starter_code.strip()
    signature_rule = (
        f"Keep EXACTLY this method signature, type hints included:\n{starter}\n"
        if starter
        else "Use the method signature the examples imply, with full type hints.\n"
    )
    prompt = (
        "You write hidden test cases for a coding assessment, like HackerRank or CodeSignal.\n\n"
        f"PROBLEM: {body.title}\n{body.statement[:12000]}\n\n"
        f"EXAMPLES (reuse this exact input format):\n{examples}\n\n"
        'Return ONLY JSON: {"reference_code": "...", "inputs": ["..."]}\n'
        "- reference_code: a correct, efficient Python 3 `class Solution`. Standard library only. "
        f"{signature_rule}"
        "- inputs: 8 to 12 inputs written EXACTLY in the example input format (same variable "
        "names, same order). Cover edge cases (empty or single element, duplicates, negatives, "
        "boundaries from the constraints) and 2 larger inputs that would time out an O(n^2) "
        f"solution. Keep every input under {_HIDDEN_MAX_INPUT_CHARS} characters.\n"
        "- Do NOT include outputs; they are computed by running reference_code.\n"
        "- Do NOT repeat the examples."
    )
    try:
        data = await LLMService().complete_json_strongest(prompt)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    reference = str(data.get("reference_code") or "").strip()
    raw_inputs = data.get("inputs") if isinstance(data.get("inputs"), list) else []
    seen = {ex.input_text.strip() for ex in body.examples}
    inputs: list[str] = []
    for item in raw_inputs:
        text = str(item).strip()
        if text and len(text) <= _HIDDEN_MAX_INPUT_CHARS and text not in seen:
            seen.add(text)
            inputs.append(text)
    if not reference or "class Solution" not in reference or len(inputs) < 3:
        raise HTTPException(status_code=503, detail="Hidden tests could not be generated for this problem.")
    return Stage1HiddenTestsResponse(reference_code=reference[:20000], inputs=inputs[:12])


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
        if sub.hidden_total > 0:
            verdict = _hidden_verdict(sub.hidden_passed, sub.hidden_total)
        else:
            verdict = _derive_verdict(
                all_passed=sub.all_passed,
                tests_passed=sub.tests_passed,
                tests_total=sub.tests_total,
                code=sub.code,
            )
        test_results = sub.test_results
        if sub.hidden_total > 0:
            # Give the reviewer the hidden outcome so the prose matches the verdict.
            test_results = json.dumps(
                {
                    "samples": test_results,
                    "hidden": f"{sub.hidden_passed} of {sub.hidden_total} hidden tests passed",
                    "hidden_failures": sub.hidden_failures[:5],
                }
            )[:20000]
        try:
            result = await svc.grade(
                title_slug=sub.slug,
                title=sub.title,
                user_code=sub.code,
                test_results=test_results,
                all_passed=sub.all_passed if sub.hidden_total == 0 else sub.hidden_passed >= sub.hidden_total,
                provider=resolve_request_provider(user, body.provider),
            )
            feedback = result.feedback
        except Exception:
            if sub.hidden_total > 0:
                feedback = _fallback_feedback(verdict, sub.hidden_passed, sub.hidden_total, hidden=True)
            else:
                feedback = _fallback_feedback(verdict, sub.tests_passed, sub.tests_total)

        return Stage1QuestionResult(
            slug=sub.slug,
            title=sub.title,
            difficulty=sub.difficulty,
            code=sub.code,
            time_used_ms=sub.time_used_ms,
            verdict=verdict,
            feedback=feedback,
            hidden_passed=sub.hidden_passed,
            hidden_total=sub.hidden_total,
            hidden_failures=sub.hidden_failures[:10],
        )

    results = await asyncio.gather(*[_grade_one(s) for s in body.submissions])

    row.stage1_results = json.dumps([r.model_dump() for r in results])
    row.status = STATUS_STAGE1_COMPLETE
    await db.commit()

    return Stage1GradeResponse(results=list(results))


def _hidden_verdict(passed: int, total: int) -> str:
    """OA verdict from hidden tests: all = strong, 80%+ = pass, 40%+ = borderline."""
    ratio = passed / total if total else 0.0
    if passed >= total:
        return "strong"
    if ratio >= 0.8:
        return "pass"
    if ratio >= 0.4:
        return "borderline"
    return "needs_work"


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


def _fallback_feedback(verdict: str, tests_passed: int, tests_total: int, hidden: bool = False) -> str:
    if tests_total > 0:
        kind = "hidden" if hidden else "sample"
        ran = f"You passed {tests_passed} of {tests_total} {kind} test cases. "
    else:
        ran = ""
    tail = {
        "strong": "Clean, working solution. Tighten the explanation of your time and space complexity next time.",
        "pass": "Solid attempt that meets the bar. Double-check edge cases under interview pressure.",
        "borderline": "Partially working. Revisit the failing cases and the core data structure choice.",
        "needs_work": "This needs more work. Start from the brute-force approach, then optimize.",
    }.get(verdict, "Keep practicing this pattern.")
    return ran + tail


# ── Stage 2: prepare the coding problem ──────────────────────────────────────

# Share of technical rounds that use a real catalog problem; the rest get a novel
# problem Kojo writes (a reskin of a catalog seed, so difficulty stays honest).
_STAGE2_CATALOG_SHARE = 0.3
_STAGE2_CATALOG_FETCH_TIMEOUT = 8


def _html_to_plain(markup: str) -> str:
    text = re.sub(r"<(br|/p|/li|/pre|/div)[^>]*>", "\n", markup or "", flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _stage2_seed(row: MockInterviewSession, rng: random.Random) -> tuple[lc_catalog.CatalogProblem, str]:
    """A catalog problem at the level's (or custom config's) difficulty and topics,
    plus the single difficulty the round targets."""
    cfg = _custom_config(row)
    difficulties = (cfg.difficulties if cfg and cfg.difficulties else _level_config(row)["coding_difficulty"].split("/"))
    difficulty = rng.choice([d for d in difficulties if d in ("Easy", "Medium", "Hard")] or ["Medium"])
    pool = [p for p in lc_catalog.catalog() if p.difficulty == difficulty]
    if cfg and (cfg.topics or cfg.subtopics):
        wanted = {lc_catalog.to_topic_id(t) for t in cfg.topics + cfg.subtopics}
        focused = [
            p for p in pool
            if p.topic in wanted or any(lc_catalog.to_topic_id(s) in wanted for s in p.subtopics)
        ]
        pool = focused or pool
    return rng.choice(pool or list(lc_catalog.catalog())), difficulty


async def _stage2_catalog_problem(slug: str, fallback_title: str) -> Optional[CodingProblemInfo]:
    """The real LeetCode statement, or None when LeetCode is unreachable (it blocks
    datacenter IPs often, see GH #75)."""
    try:
        data = await asyncio.wait_for(LeetCodeService().get_problem(slug), _STAGE2_CATALOG_FETCH_TIMEOUT)
    except Exception:
        return None
    if not data.content_html:
        return None
    return CodingProblemInfo(
        title=data.title or fallback_title,
        slug=data.title_slug or slug,
        difficulty=data.difficulty or "Medium",
        prompt=_html_to_plain(data.content_html)[:20000],
        prompt_html=data.content_html[:60000],
        examples=[
            CodingProblemExample(
                input_text=ex.input_text[:4000],
                output_text=ex.output_text[:4000],
                explanation_text=(ex.explanation_text or None) and ex.explanation_text[:4000],
            )
            for ex in data.examples[:10]
        ],
        starter_code=(data.python_snippet or "")[:20000],
        source="catalog",
    )


@router.post("/{session_id}/stage2/problem", response_model=CodingProblemInfo)
@limiter.limit("10/minute")
async def stage2_problem(
    request: Request,
    response: Response,
    session_id: int,
    body: Stage2ProblemRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CodingProblemInfo:
    """Pick the technical round's problem before Kojo presents it. About 70% are novel
    problems Kojo writes; about 30% are real catalog problems chosen here, so titles
    and slugs are never invented. Seeded by session so a retry lands on the same pick.
    Like a real phone screen, the constraints and follow-up are held back for Kojo."""
    row = await _load_session(session_id, user, db)
    return withhold_problem_details(await _pick_stage2_problem(row, body, db, user))


async def _pick_stage2_problem(
    row: MockInterviewSession, body: Stage2ProblemRequest, db: AsyncSession, user: User
) -> CodingProblemInfo:
    rng = random.Random(f"stage2-{row.id}")
    cfg = _custom_config(row)

    # A custom company with chosen problems keeps using them, as before.
    if cfg and cfg.problems:
        pick = rng.choice(cfg.problems[:6])
        if pick.slug.startswith("custom-"):
            custom = (
                await db.execute(
                    select(LCCustomProblem).where(LCCustomProblem.user_id == user.id, LCCustomProblem.slug == pick.slug)
                )
            ).scalar_one_or_none()
            if custom is not None:
                try:
                    cases = json.loads(custom.test_cases_json or "[]")
                except ValueError:
                    cases = []
                cases = cases if isinstance(cases, list) else []
                return CodingProblemInfo(
                    title=custom.title[:300],
                    slug=custom.slug,
                    difficulty=custom.difficulty if custom.difficulty in ("Easy", "Medium", "Hard") else "Medium",
                    prompt=(custom.description or "")[:20000],
                    examples=[
                        CodingProblemExample(
                            input_text=str(c.get("input_text", ""))[:4000],
                            output_text=str(c.get("output_text", ""))[:4000],
                        )
                        for c in cases[:10]
                        if isinstance(c, dict) and c.get("input_text")
                    ],
                    starter_code=(custom.starter_code or "")[:20000],
                    source="custom",
                )
        else:
            real = await _stage2_catalog_problem(pick.slug, pick.title or pick.slug)
            if real is not None:
                return real

    seed, difficulty = _stage2_seed(row, rng)
    if rng.random() < _STAGE2_CATALOG_SHARE:
        real = await _stage2_catalog_problem(seed.slug, seed.title)
        if real is not None:
            return real
        # LeetCode unreachable: reskin the same seed instead of inventing a title.

    try:
        generated = await LeetCodeService().generate_daily_problem(
            topic=seed.topic_label,
            target_difficulty=difficulty,
            seed_title=seed.title,
            provider=resolve_request_provider(user, body.provider),
        )
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not generated.title or not generated.description:
        raise HTTPException(status_code=503, detail="Kojo couldn't write a problem. Try again.")
    return CodingProblemInfo(
        title=generated.title[:300],
        slug=f"mock-{row.id}",
        difficulty=generated.difficulty if generated.difficulty in ("Easy", "Medium", "Hard") else difficulty,
        prompt=generated.description[:20000],
        examples=[
            CodingProblemExample(
                input_text=tc.input_text, output_text=tc.output_text, explanation_text=tc.explanation_text
            )
            for tc in generated.test_cases[:10]
        ],
        starter_code=generated.starter_code[:20000],
        source="novel",
    )


# ── Stage 2: grade the technical round ───────────────────────────────────────

_STAGE2_VERDICTS = ("strong", "pass", "borderline", "needs_work")


def _transcript_text(history: list[InterviewChatMessage], candidate: str, limit: int = 14000) -> str:
    lines = [
        f"{'Kojo' if m.role == 'interviewer' else candidate}: {m.content.strip()[:6000]}"
        for m in history
    ]
    text = "\n".join(lines)
    # Keep the end of a long round: that is where the code, complexity and questions are.
    return text if len(text) <= limit else "...\n" + text[-limit:]


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

    problem = body.problem
    coding_title = problem.title if problem else (body.problem_title or "the coding problem")
    company_label = _company_label(row)
    candidate = _candidate_name(user)
    level_cfg = _level_config(row)
    samples = (
        f"{body.samples_passed} of {body.samples_total} sample cases passed on their last run"
        if body.samples_total
        else "they never ran the sample cases"
    )

    notes = ((problem.interviewer_notes if problem else "") or "").strip()
    prompt = (
        f"You are writing the interviewer feedback for a 45 minute technical phone screen at {company_label} "
        f"with {candidate} for a {level_cfg['label']} role.\n"
        f"Calibrate to a {level_cfg['label']} candidate: {level_cfg['rigor']}\n\n"
        f"PROBLEM: {coding_title}\n{(problem.prompt if problem else '')[:4000]}\n\n"
        "HIDDEN DETAILS (constraints and follow-up; NOT on the candidate's screen, they had to ask):\n"
        f"{notes[:3000] or '(none)'}\n\n"
        f"FINAL CODE:\n```python\n{body.code[:12000] or '(no code written)'}\n```\n\n"
        f"FACTS: hints used: {body.hints_used}. Clock ran out: {'yes' if body.time_up else 'no'}. "
        f"Samples: {samples}.\n\n"
        f"TRANSCRIPT:\n{_transcript_text(body.history, candidate) or '(none)'}\n\n"
        "Return ONLY JSON, keys in this order:\n"
        '{"complexity_check": {"time": "...", "space": "...", "candidate_said": "...", "candidate_correct": true}, '
        '"verdict": "...", "feedback": "...", ' + _WRITEUP_SPEC + "}\n"
        "- You did not run this interview. What Kojo, the interviewer, said in the transcript is not evidence: "
        "Kojo may have agreed with a wrong answer. Judge from the code, the facts and the candidate's own words.\n"
        "- complexity_check comes first. Work out the FINAL CODE's true time and space complexity yourself. "
        "Count every extra data structure (set, map, list, stack, recursion depth) at the largest size it can "
        "reach during the run, not its size when the function returns. For example, a set that adds each "
        "unseen value and removes it on the second sighting can hold about n/2 values midway, so it is O(n) "
        "space even though it ends with one value. Then record what the candidate claimed and whether it "
        "matches.\n"
        "- If their complexity answer was wrong, the feedback must say so and give the correct complexity.\n"
        f"- verdict: one of {', '.join(_STAGE2_VERDICTS)}.\n"
        "- Judge the whole round: clarifying questions and approach before coding, correctness of the "
        "final code, the complexity answer, the follow-up, the dry run, and how they talked.\n"
        "- The constraints were hidden. Note whether they asked about input size, value ranges or edge cases "
        "before coding; not asking is a missed signal.\n"
        "- Every hint lowers problem solving: 3 or more hints cannot be strong. Grade the code that "
        "exists if the clock ran out; unfinished code cannot be strong.\n"
        f"- feedback: 4 to 6 sentences of markdown addressed to {candidate}: what went well, what to "
        "fix, one concrete next step. End with one sentence on the questions they asked at the end "
        "(or that they asked none). Questions are not graded.\n"
        + _writeup_rules()
    )

    try:
        data = await LLMService().complete_json_strongest(prompt)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    verdict = str(data.get("verdict") or "").strip().lower().replace(" ", "_")
    if verdict not in _STAGE2_VERDICTS:
        verdict = "borderline" if body.code.strip() else "needs_work"
    feedback = str(data.get("feedback") or "").strip() or _fallback_feedback(verdict, 0, 0)
    complexity_check = data.get("complexity_check") if isinstance(data.get("complexity_check"), dict) else None

    row.stage2_submission = json.dumps(
        {
            "code": body.code,
            "feedback": feedback,
            "verdict": verdict,
            "hints_used": body.hints_used,
            "time_up": body.time_up,
            "samples_passed": body.samples_passed,
            "samples_total": body.samples_total,
            "complexity_check": complexity_check,
            "writeup": _clean_writeup(data.get("writeup")),
            "problem": {
                "title": coding_title,
                "slug": problem.slug if problem else body.problem_slug,
                "difficulty": problem.difficulty if problem else "",
                "source": problem.source if problem else "",
            },
        }
    )
    row.status = STATUS_STAGE2_COMPLETE
    await db.commit()

    return Stage2SubmitResponse(feedback=feedback, verdict=verdict)


# ── Stage 2: conversational interview ────────────────────────────────────────

_STAGE2_STEP_NAMES = {
    "background": "Background",
    "coding_problem": "Present the problem",
    "approach": "Approach and coding",
    "complexity": "Complexity",
    "optimize": "Follow-up",
    "dry_run": "Dry run",
    "questions": "Closing questions",
}


def _stage2_step(candidate: str, goal: str) -> str:
    """What Kojo does on one step of the technical round."""
    return {
        "background": f"introduce yourself in one sentence and ask {candidate} ONE quick background question "
        "(what they are working on now, or a recent project). No other questions",
        "coding_problem": "thank them in a few words, then present the problem: it is now on their screen, so "
        "summarise it in 1 or 2 sentences and invite clarifying questions before they code",
        "approach": "answer clarifying questions and hear their approach BEFORE code. If they start coding "
        "without explaining, ask them to talk you through the plan first. Once the plan is reasonable, let "
        "them code: stay brief and react to what is in the editor. This step is done once the code looks "
        "complete",
        "complexity": "ask for the time and space complexity of the code in the editor. Work out the true answer "
        "yourself first: count every extra data structure (set, map, list, stack, recursion depth) at the "
        "largest size it can reach during the run, not its size at the end. If their answer is wrong, do not "
        "give the answer: push back with one question that exposes it (for example, how big can that set get "
        "halfway through?)",
        "optimize": "give ONE real follow-up. Use the FOLLOW-UP in the hidden details when there is one (for "
        "example, now do it in O(1) extra space); otherwise tighten a constraint or change the input (sorted, "
        "streaming, far larger). Have them adapt the approach out loud, and the code if there is time",
        "dry_run": "ask them to dry run their code on a small example or an edge case, and point at the line "
        "if a bug shows up",
        "questions": 'ask "Do you have any questions for me?" and answer in character as an engineer at the '
        "company, briefly and honestly",
    }[goal]


@router.post("/{session_id}/stage2/message", response_model=Stage2MessageResponse)
@limiter.limit("10/minute")
async def stage2_message(
    request: Request,
    response: Response,
    session_id: int,
    body: Stage2MessageRequest,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Stage2MessageResponse:
    await screen_user_input(user, "mock_interview", body.message)
    row = await _load_session(session_id, user, db)
    company_label = _company_label(row)
    candidate = _candidate_name(user)
    level_cfg = _level_config(row)

    turn_count = sum(1 for m in body.history if m.role == "user")
    history_text = _clip_history("\n".join(
        f"{'You (Kojo)' if m.role == 'interviewer' else candidate}: {m.content}" for m in body.history
    ))

    covered = normalize_covered(body.covered_goals, _STAGE2_GOALS)
    presented = "coding_problem" in covered
    problem = body.problem
    time_up = body.event == "time_up" or body.minutes_left == 0
    starting = body.message is None and body.event is None
    user_turn = body.message is not None
    followups = body.followups_on_current
    # The first thing the candidate says answers the background question, so the
    # problem goes up on that turn. Deterministic: no waiting on the model to decide.
    present_now = not presented and not starting and problem is not None and not time_up
    # Closing Q&A: "Do you have any questions for me?" was already asked.
    closing = "questions" in covered

    steps = [g for g in _STAGE2_GOALS if g not in ("background", "coding_problem")]
    plan = None
    if starting:
        this_turn = f"{_STAGE2_STEP_NAMES['background']}: {_stage2_step(candidate, 'background')}."
    elif present_now:
        this_turn = f"{_STAGE2_STEP_NAMES['coding_problem']}: {_stage2_step(candidate, 'coding_problem')}."
    elif not presented:
        # The problem is not ready yet: keep the background chat going.
        this_turn = "Keep the background chat going in one or two sentences while the problem is prepared."
    elif body.event == "time_up":
        this_turn = "Wrap up as described under RIGHT NOW."
    elif time_up or closing:
        this_turn = (
            "Closing questions: they have had the chance to ask you questions. Answer what they asked briefly "
            "and in character. Set is_done true once you have answered (or they have none)."
        )
    else:
        current_step = next((g for g in steps if g not in covered), "questions")
        plan = plan_turn(
            [g for g in covered if g in steps], steps, followups, _STAGE2_FOLLOWUP_CAPS.get(current_step, 1)
        )
        current, nxt = plan.current or "questions", plan.next or "questions"
        start_next = f"{_STAGE2_STEP_NAMES[nxt]}: {_stage2_step(candidate, nxt)}"
        if not user_turn:
            this_turn = f"Stay on {_STAGE2_STEP_NAMES[current]}: {_stage2_step(candidate, current)}."
        elif plan.must_advance:
            this_turn = (
                f"{_STAGE2_STEP_NAMES[current]} has run its course. Set step_done true, close it in a few neutral "
                f"words, and start the next step now. {start_next}."
            )
        else:
            this_turn = (
                f"CURRENT STEP, {_STAGE2_STEP_NAMES[current]}: {_stage2_step(candidate, current)}.\n"
                "Decide whether the candidate's latest message completes the current step.\n"
                "- If it does: set step_done true, react in a few neutral words, and in the same reply start the "
                f"next step. {start_next}.\n"
                "- If it does not: set step_done false and stay on the current step with ONE short follow-up or "
                "push back. Never repeat a question you already asked word for word."
            )

    if problem is not None:
        origin = (
            f"This is LeetCode's {problem.title}."
            if problem.source == "catalog"
            else "You wrote this problem yourself. It is not a LeetCode problem: never name or link one."
        )
        notes = (problem.interviewer_notes or "").strip()
        problem_block = (
            f"THE PROBLEM{' (on the candidate screen)' if presented or present_now else ' (not shown yet)'}: "
            f"{problem.title} ({problem.difficulty}). {origin}\n{problem.prompt[:5000]}\n\n"
            "HIDDEN DETAILS (not on their screen; share one only when they ask about it, never volunteer it):\n"
            + (
                notes[:3000]
                if notes
                else "None written down. If they ask about input size, value ranges or edge cases, give "
                "sensible constraints for this problem."
            )
            + "\n\n"
        )
    else:
        problem_block = ""
    if presented:
        code = body.code.strip()
        code_block = (
            "THE CANDIDATE'S EDITOR RIGHT NOW (a shared doc; they may still be typing):\n"
            f"```python\n{code[:6000]}\n```\n\n"
            if code
            else "THE CANDIDATE'S EDITOR RIGHT NOW: empty.\n\n"
        )
    else:
        code_block = ""

    event_line = {
        "hint": f"{candidate} pressed the hint button. Give ONE small hint that moves them one step, based on "
        "their code and approach. Never the full solution. Set hint_given true.",
        "nudge": f"{candidate} has been quiet for a few minutes. Check in briefly (ask what they are thinking "
        "about). Do not give a hint unless they ask for one.",
        "time_up": "The 45 minutes are up. In one sentence say you are at time and thank them, then ask "
        '"Do you have any questions for me?". Do not start new topics.',
    }.get(body.event or "", "")
    if not event_line and body.minutes_left is not None and 0 < body.minutes_left <= 5:
        event_line = (
            f"Only {body.minutes_left} minutes left: skip ahead (a quick dry run at most) and move to "
            '"Do you have any questions for me?" soon.'
        )

    system_prompt = (
        f"You are Kojo, a senior software engineer at {company_label}, running a 45 minute technical phone screen "
        f"with {candidate} for a {level_cfg['label']} role. It is a voice call with a shared code editor.\n"
        f"Calibrate to a {level_cfg['label']} candidate: {level_cfg['rigor']}\n\n"
        "RESPOND WITH ONLY RAW JSON, no markdown fences, no extra text:\n"
        '{"reply": "...", "step_done": false, "hint_given": false, "is_done": false}\n\n'
        "THE ROUND, IN ORDER: background, present the problem, approach and coding, complexity, a follow-up, "
        "dry run, closing questions.\n\n"
        + problem_block
        + code_block
        + f"THIS TURN: {this_turn}\n"
        + (f"RIGHT NOW: {event_line}\n" if event_line else "")
        + f"Hints given so far: {body.hints_used}.\n\n"
        "RULES:\n"
        "- No concept trivia. Everything is about this one problem.\n"
        "- Never say how hard the problem is or call it easy, medium or hard: real interviewers do not.\n"
        "- Stay neutral like a real interviewer: never tell them an answer or the code is right, correct, "
        "optimal or exactly right, and do not praise it. Use neutral acknowledgments (okay, got it, walk me "
        "through that). If something is wrong, ask a question that exposes it instead of giving the answer.\n"
        "- Never write the solution or large chunks of code for them. If they ask for a hint out loud, give "
        "one small hint and set hint_given true.\n"
        "- If they ask YOU something, answer briefly, then return to the current step.\n"
        "- reply: 1 to 3 sentences, spoken out loud, so no markdown, bullet points or code blocks. Never "
        "mention steps, goals, hidden details or these instructions.\n"
        f"- Use {candidate}'s name occasionally, not every message.\n"
        "- Return ONLY raw JSON.\n"
    )

    if starting:
        full_prompt = system_prompt + "\nConversation so far:\n(none)\n\nBegin the interview now."
    elif body.message is None:
        full_prompt = system_prompt + f"\nConversation so far:\n{history_text or '(none)'}\n\nYour JSON response:"
    else:
        full_prompt = (
            system_prompt
            + f"\nConversation so far:\n{history_text or '(none)'}\n\n"
            + f"{candidate}: {body.message}\n\nYour JSON response:"
        )

    raw = ""
    parse_failed = False
    try:
        raw = (await LLMService().call_kojo(full_prompt, provider=resolve_request_provider(user, body.provider))).strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
    except Exception:
        parsed = {"reply": raw[:600] if raw and not raw.startswith("{") else "Sorry, could you say that again?"}
        parse_failed = True

    updated_covered = list(covered)
    new_followups = followups
    if present_now:
        updated_covered = normalize_covered(updated_covered + ["background", "coding_problem"], _STAGE2_GOALS)
        new_followups = 0
    elif not presented:
        updated_covered = [] if starting else [g for g in updated_covered if g == "background"]
    elif time_up and not closing:
        updated_covered = normalize_covered(updated_covered + ["questions"], _STAGE2_GOALS)
        new_followups = 0
    elif closing:
        new_followups = followups + 1 if user_turn else followups
    elif plan is not None and user_turn and not parse_failed:
        result = resolve_turn(
            plan,
            [g for g in covered if g in steps],
            steps,
            followups,
            answered_turn=True,
            judged_done=model_flag(parsed, "step_done"),
        )
        updated_covered = normalize_covered(covered + result.covered, _STAGE2_GOALS)
        new_followups = result.followups
        if result.advanced and plan.next in (None, "questions"):
            # This reply asks the closing question, so the next answer is closing Q&A.
            updated_covered = normalize_covered(updated_covered + ["questions"], _STAGE2_GOALS)

    # Done once Kojo has answered the closing questions: "questions" must have been
    # asked on an earlier turn (or at the time-up turn), then the model says so.
    asked_before = closing or (time_up and body.event is None)
    is_done = model_flag(parsed, "is_done") and asked_before and user_turn
    if closing and user_turn and followups + 1 >= _STAGE2_FOLLOWUP_CAPS["questions"]:
        is_done = True
    if turn_count + 1 >= _STAGE2_TURN_CAP:
        is_done = True

    reply = scrub_reply(str(parsed.get("reply") or "")) or "Go on, I'm listening."
    if present_now and not re.search(r"(problem|screen|question|prompt)", reply, re.I):
        # The problem just went up on their screen. Smaller models sometimes re-greet
        # or ask something else here instead (seen on NVIDIA, session 114), which
        # leaves the candidate staring at an unexplained problem: say it plainly.
        reply = (
            f"Thanks, {candidate}. The problem is up on your screen now: {problem.title}. Take a minute to "
            "read it, and ask me anything you want to clarify before you start."
        )
    _record_transcript(row, "stage2", body.history, body.message, reply)
    row.status = STATUS_STAGE2
    await db.commit()

    return Stage2MessageResponse(
        reply=reply,
        coding_problem=problem if present_now else None,
        is_done=is_done,
        covered_goals=updated_covered,
        # A nudge is Kojo checking in on a silence, never a hint the candidate asked for.
        hint_given=body.event == "hint" or (body.event != "nudge" and model_flag(parsed, "hint_given")),
        followups_on_current=new_followups,
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
    await screen_user_input(user, "mock_interview", body.message)
    row = await _load_session(session_id, user, db)
    provider = resolve_request_provider(user, body.provider)
    company_label = _company_label(row)
    candidate = _candidate_name(user)
    culture_hint = _culture_hint(row)
    level_cfg = _level_config(row)

    turn_count = sum(1 for m in body.history if m.role == "user")

    history_text = _clip_history("\n".join(
        f"{'You (Interviewer)' if m.role == 'interviewer' else candidate}: {m.content}"
        for m in body.history
    ))

    # Five behavioral questions, one per goal. The client echoes the goals covered so
    # far; the server owns progress (GH #221) and the model only judges the answer.
    covered = normalize_covered(body.covered_goals, _STAGE3_GOALS)
    followups = body.followups_on_current
    plan = plan_turn(covered, _STAGE3_GOALS, followups, _STAGE3_FOLLOWUP_CAP)
    total = len(_STAGE3_GOALS)

    def _ask(goal: Optional[str]) -> str:
        if goal is None:
            return (
                'ask "Do you have any questions for me?" (that was the last of the 5 behavioral questions). '
                "Nothing else."
            )
        number = _STAGE3_GOALS.index(goal) + 1
        return (
            f"ask behavioral question {number} of {total}: a NEW STAR question tailored to {company_label}'s "
            "culture, on a different theme from every question already asked in the conversation below."
        )

    if body.message is None:
        this_turn = (
            "Open the interview: introduce yourself in one or two warm sentences, then "
            + _ask(_STAGE3_GOALS[0] if not covered else plan.current)
        )
    elif plan.current is None:
        this_turn = (
            "All 5 behavioral questions are done and you asked if they have questions for you. Answer what they "
            "asked briefly and honestly, in character as an engineer at the company. Ask no new behavioral "
            "questions. Set is_done true once you have answered (or they have none)."
        )
    elif plan.must_advance:
        this_turn = (
            "You already probed this story twice, so move on now. Set answered true. One short neutral "
            "acknowledgment, then " + _ask(plan.next)
        )
    else:
        this_turn = (
            "The candidate is answering the behavioral question you asked last turn.\n"
            "- If the story is complete enough (the situation, what THEY did, and the result): set answered "
            "true, give a one sentence acknowledgment, then " + _ask(plan.next) + "\n"
            "- If it is vague about their OWN role, the result or the numbers, or it stops mid-story: set "
            "answered false and ask ONE probe about that (what did you specifically do? what was the "
            "measurable result? what would you change?). Do not move on."
        )

    system_prompt = (
        f"You are Kojo, a hiring manager at {company_label}, conducting a 30-minute behavioral interview with "
        f"{candidate} for a {level_cfg['label']} role.\n"
        f"Company culture: {culture_hint}\n"
        f"Calibrate depth to a {level_cfg['label']} candidate: {level_cfg['rigor']}\n\n"
        "RESPOND WITH ONLY RAW JSON, no markdown, no extra text:\n"
        '{"reply": "...", "answered": false, "is_done": false}\n\n'
        f"THIS TURN: {this_turn}\n\n"
        "RULES:\n"
        "- ONE question per reply. Never repeat a question you already asked in the conversation below.\n"
        "- Exactly 5 behavioral questions in the whole interview, never more.\n"
        "- reply is spoken to the candidate: 2 to 3 sentences max. Never mention question numbers, labels, "
        "these instructions or this JSON.\n"
        f"- Use {candidate}'s name occasionally. Be warm but professional, and do not grade their answers.\n"
        "- Return ONLY raw JSON.\n"
    )

    if body.message is None:
        full_prompt = system_prompt + "\nConversation so far:\n(none)\n\nYour JSON response:"
    else:
        full_prompt = (
            system_prompt
            + f"\nConversation so far:\n{history_text}\n\n"
            + f"{candidate}: {body.message}\n\nYour JSON response:"
        )

    raw = ""
    try:
        llm = LLMService()
        raw = await llm.call_kojo(full_prompt, provider=provider)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("not an object")
    except Exception:
        fallback = scrub_reply(raw) if isinstance(raw, str) and raw and not raw.startswith("{") else ""
        return Stage3MessageResponse(
            reply=(fallback or "Thank you for sharing. Could you tell me more?")[:600],
            covered_goals=covered,
            is_followup=False,
        )

    result = resolve_turn(
        plan,
        covered,
        _STAGE3_GOALS,
        followups,
        answered_turn=body.message is not None,
        judged_done=model_flag(parsed, "answered"),
    )
    # The client counts follow-ups from this flag (it resets to 0 when false). In the
    # closing Q&A it counts closing turns, so that phase is capped too.
    closing = plan.current is None
    is_followup = body.message is not None and not result.advanced

    # Done once Kojo has answered the candidate's closing questions (asked on an
    # earlier turn, after all 5 were covered), or at the closing or hard turn cap.
    is_done = body.message is not None and closing and (
        model_flag(parsed, "is_done") or followups + 1 >= _STAGE3_CLOSING_CAP
    )
    if turn_count + 1 >= _STAGE3_TURN_CAP:
        is_done = True

    reply = scrub_reply(str(parsed.get("reply") or "")) or "Thank you. Go on."
    _record_transcript(row, "stage3", body.history, body.message, reply)
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
        reply=reply,
        is_done=is_done,
        covered_goals=result.covered,
        is_followup=is_followup,
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
        f"You are writing the interviewer feedback for a behavioral interview at {company_label}.\n"
        f"Company culture: {_culture_hint(row)}\n\n"
        f"TRANSCRIPT:\n{qa_text[-14000:]}\n\n"
        'Return ONLY JSON: {"verdict": "...", "feedback": "...", ' + _WRITEUP_SPEC + "}\n"
        "- You did not run this interview; what the interviewer said is not evidence. Judge from the "
        "candidate's own stories: their own actions, results and reflection.\n"
        f"- verdict: one of {', '.join(_STAGE2_VERDICTS)}.\n"
        f"- feedback: 2 to 3 sentences on {candidate}'s behavioral answers: what was strong, what needs "
        "improvement, and whether they align with the company's culture. Direct and professional.\n"
        + _writeup_rules()
    )
    verdict = None
    writeup = None
    try:
        data = await LLMService().complete_json_strongest(eval_prompt)
        feedback = str(data.get("feedback") or "").strip() or "Behavioral evaluation unavailable."
        raw_verdict = str(data.get("verdict") or "").strip().lower().replace(" ", "_")
        verdict = raw_verdict if raw_verdict in _STAGE2_VERDICTS else None
        writeup = _clean_writeup(data.get("writeup"))
    except Exception:
        feedback = "Behavioral evaluation unavailable."

    row.stage3_answers = json.dumps({"feedback": feedback, "verdict": verdict, "writeup": writeup})
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
        rubric = _load_rubric(row.skill_ratings)
        return FinishResponse(
            overall_feedback=row.overall_feedback,
            resume_verdict=resume_verdict,
            stage1_verdict=stage1_verdict,
            stage2_verdict=stage2_verdict,
            stage3_verdict=stage3_verdict,
            hiring_recommendation=rubric["call"] if rubric else _extract_recommendation(row.overall_feedback),
            skill_ratings=rubric["skills"] if rubric else None,
        )

    # A real committee never sees the interviews: only each interviewer's packet,
    # the OA results and the resume screen (GH #221).
    packets = "\n\n".join(
        [
            f"RESUME SCREEN (ATS, context only):\n{_summarize_resume(row.resume_screen)}",
            _packet("RESUME DEEP DIVE", row.resume_grill, _summarize_resume_grill(row.resume_grill)),
            f"ONLINE ASSESSMENT (auto-graded on hidden tests):\n{_summarize_stage1(row.stage1_results)}",
            _packet(
                "TECHNICAL PHONE SCREEN",
                row.stage2_submission,
                _summarize_stage2(row.stage2_submission),
                facts=_stage2_facts(row.stage2_submission),
            ),
            _packet("BEHAVIORAL", row.stage3_answers, _summarize_stage3(row.stage3_answers)),
        ]
    )

    scale = " / ".join(HIRE_SCALE)
    prompt = (
        f"You are the hiring committee at {company_label} deciding on a {level_cfg['label']} candidate after "
        "an interview loop.\n"
        "Like a real committee, you did not attend any interview and you never see transcripts. You have only "
        "each interviewer's written packet, the online assessment results and the resume screen.\n"
        f"Judge against the {level_cfg['label']} bar: {level_cfg['rigor']}\n\n"
        f"{packets}\n\n"
        "Return ONLY JSON:\n"
        '{"call": "...", "skills": {"coding": "...", "problem_solving": "...", "communication": "...", '
        '"testing": "..."}, "writeup": "..."}\n'
        f"- call and every skill use exactly one of: {scale}.\n"
        "- Decide from the evidence and facts, not from an interviewer's tone or their own rating. Discount a "
        "rating its evidence does not support.\n"
        "- Weigh consistency across rounds: one strong round does not cancel a clear red flag in another. A "
        "skipped round gives no signal either way.\n"
        "- coding: correctness and code quality (OA hidden tests, technical solution).\n"
        "- problem_solving: approach, complexity, the follow-up, and how many hints were needed (hints lower "
        "it).\n"
        "- communication: clarifying questions, explaining the approach, STAR clarity, questions asked "
        "at the end.\n"
        "- testing: edge cases, dry runs, hidden test results.\n"
        "- Skip a skill (null) only when no packet has evidence for it.\n"
        "- writeup: 3 to 5 sentences of markdown addressed to the candidate: strengths, what to improve, and "
        "a closing line that agrees with call. Do not add a separate recommendation line.\n"
        "- The resume screen is context only. Be direct and professional."
    )

    try:
        data = await LLMService().complete_json_strongest(prompt)
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    call = _normalize_hire(data.get("call")) or "LEAN NO HIRE"
    raw_skills = data.get("skills") if isinstance(data.get("skills"), dict) else {}
    skills = {
        key: rating
        for key in SKILL_KEYS
        if (rating := _normalize_hire(raw_skills.get(key))) is not None
    }
    overall_feedback = _strip_recommendation_line(str(data.get("writeup") or "").strip()) or "Debrief unavailable."

    row.overall_feedback = overall_feedback
    row.skill_ratings = json.dumps({"call": call, "skills": skills})
    row.status = STATUS_COMPLETE
    await db.commit()

    return FinishResponse(
        overall_feedback=overall_feedback,
        resume_verdict=resume_verdict,
        stage1_verdict=stage1_verdict,
        stage2_verdict=stage2_verdict,
        stage3_verdict=stage3_verdict,
        hiring_recommendation=call,
        skill_ratings=skills,
    )


# ── Interviewer write-ups for the hiring committee ────────────────────────────
# Each graded round stores a packet; the committee reads only these (GH #221).

_WRITEUP_SPEC = (
    '"writeup": {"rating": "...", "signals": {"coding": "...", "problem_solving": "...", '
    '"communication": "...", "testing": "..."}, "evidence": ["..."], "concerns": ["..."]}'
)


def _writeup_rules() -> str:
    scale = " / ".join(HIRE_SCALE)
    return (
        "- writeup is your packet for the hiring committee, who never see the transcript. evidence: 3 to 6 "
        "short factual bullets (what the candidate did, said or wrote; quote them when useful). concerns: the "
        f"specific gaps, or []. signals: rate each skill this round actually tested with one of {scale}, null "
        f"when the round gave no evidence for it. rating: your overall call, one of {scale}."
    )


def _clean_writeup(value: object) -> Optional[dict]:
    if not isinstance(value, dict):
        return None
    raw_signals = value.get("signals") if isinstance(value.get("signals"), dict) else {}
    signals = {k: r for k in SKILL_KEYS if (r := _normalize_hire(raw_signals.get(k))) is not None}

    def _bullets(key: str) -> list[str]:
        items = value.get(key)
        if not isinstance(items, list):
            return []
        return [str(x).strip()[:400] for x in items if str(x).strip()][:8]

    evidence, concerns = _bullets("evidence"), _bullets("concerns")
    rating = _normalize_hire(value.get("rating"))
    if not rating and not evidence:
        return None
    return {"rating": rating, "signals": signals, "evidence": evidence, "concerns": concerns}


def _stage2_facts(stage2_submission_json: Optional[str]) -> str:
    try:
        data = json.loads(stage2_submission_json or "")
    except ValueError:
        return ""
    if not isinstance(data, dict):
        return ""
    problem = data.get("problem") or {}
    facts = (
        f"Problem: {problem.get('title', 'unknown')} ({problem.get('difficulty') or 'unknown'}). "
        f"Hints used: {data.get('hints_used', 0)}. Clock ran out: {'yes' if data.get('time_up') else 'no'}."
    )
    if data.get("samples_total"):
        facts += f" Sample cases: {data.get('samples_passed', 0)} of {data['samples_total']} passed."
    check = data.get("complexity_check")
    if isinstance(check, dict) and (check.get("time") or check.get("space")):
        facts += (
            f" Final code complexity (checked by the grader): time {check.get('time')}, space {check.get('space')}; "
            f"candidate said: {check.get('candidate_said') or 'nothing'}"
            f" ({'correct' if check.get('candidate_correct') else 'incorrect'})."
        )
    return facts


def _packet(title: str, raw_json: Optional[str], fallback: str, facts: str = "") -> str:
    """One round as the committee sees it: the interviewer's write-up, or for runs
    graded before write-ups existed, the interviewer's summary."""
    try:
        data = json.loads(raw_json) if raw_json else None
    except ValueError:
        data = None
    writeup = data.get("writeup") if isinstance(data, dict) else None
    if not isinstance(writeup, dict):
        return f"{title} (no structured write-up, interviewer summary):\n{fallback}"
    lines = [f"{title}", f"Interviewer rating: {writeup.get('rating') or 'none given'}"]
    signals = writeup.get("signals") or {}
    if signals:
        lines.append("Signals: " + ", ".join(f"{k}={v}" for k, v in signals.items()))
    if facts:
        lines.append(f"Facts: {facts}")
    lines.append("Evidence:")
    lines.extend(f"- {e}" for e in writeup.get("evidence") or ["(none recorded)"])
    lines.append("Concerns:")
    lines.extend(f"- {c}" for c in writeup.get("concerns") or ["(none recorded)"])
    return "\n".join(lines)


# Six-step hiring-committee scale, used for every new debrief (old runs keep the
# four-step STRONG HIRE / HIRE / BORDERLINE / NO HIRE ladder read from their text).
HIRE_SCALE = ("STRONG NO HIRE", "NO HIRE", "LEAN NO HIRE", "LEAN HIRE", "HIRE", "STRONG HIRE")
SKILL_KEYS = ("coding", "problem_solving", "communication", "testing")


def _normalize_hire(value: object) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = " ".join(value.upper().replace("_", " ").split())
    return text if text in HIRE_SCALE else None


def _strip_recommendation_line(text: str) -> str:
    lines = [ln for ln in text.splitlines() if not ln.strip().lower().lstrip("*_ ").startswith("recommendation")]
    return "\n".join(lines).strip()


def _load_rubric(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    call = _normalize_hire(data.get("call"))
    if not call:
        return None
    skills = data.get("skills") if isinstance(data.get("skills"), dict) else {}
    return {"call": call, "skills": {k: v for k, v in skills.items() if _normalize_hire(v)}}


# ── List sessions ─────────────────────────────────────────────────────────────

@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    """Delete one past (or unfinished) interview and everything saved on it."""
    row = await _load_session(session_id, user, db)
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
        progress_json=row.progress_json,
        progress_updated_at=row.progress_updated_at.isoformat() if row.progress_updated_at else None,
        resume_file_name=row.resume_file_name,
        resume_grill=row.resume_grill,
        skill_ratings=row.skill_ratings,
        created_at=row.created_at.isoformat() if row.created_at else None,
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


def _summarize_resume_grill(resume_grill_json: Optional[str]) -> str:
    if not resume_grill_json:
        return "Resume deep dive was skipped or not completed."
    try:
        data = json.loads(resume_grill_json)
        return data.get("feedback", "No feedback recorded.")
    except Exception:
        return "Resume deep dive feedback unavailable."


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
        feedback = data.get("feedback", "No feedback recorded.")
        if "hints_used" not in data:
            return feedback
        problem = data.get("problem") or {}
        facts = (
            f"Problem: {problem.get('title', 'unknown')} ({problem.get('difficulty') or 'unknown'}). "
            f"Verdict: {str(data.get('verdict', '')).upper()}. Hints used: {data.get('hints_used', 0)}. "
            f"Clock ran out: {'yes' if data.get('time_up') else 'no'}. "
        )
        if data.get("samples_total"):
            facts += f"Sample cases: {data.get('samples_passed', 0)} of {data['samples_total']} passed. "
        return facts + feedback
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
        if data.get("verdict") in _STAGE2_VERDICTS:
            return data["verdict"]
        # Older runs stored prose only.
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
        if data.get("verdict") in _STAGE2_VERDICTS:
            return data["verdict"]
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
