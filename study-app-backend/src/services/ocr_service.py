"""OCR engine routing for the STEM Scratch Pad feature.

Transcribes a student's handwritten scratch-pad drawing so grading can address
the reasoning path, not just the final answer. See
.claude/design-patterns/ocr-routing.md for the full design rationale: every
engine returns the same OcrResult shape so the engine choice can only affect
transcription fidelity, never grading policy.

Stateless, instantiated per request, matching every other service in this
codebase.
"""
from __future__ import annotations

import re
from typing import Awaitable, Callable, Optional

from src.schemas.attempt_schema import OCR_LOW_CONFIDENCE_THRESHOLD, OcrResult
from src.services.llm_service import LLMService
from src.utils.logger import get_logger

logger = get_logger(__name__)

# Re-exported for callers that only import ocr_service (the constant's real
# home is attempt_schema.py, to avoid a circular import with llm_service.py,
# which also needs it and must not import this module).
LOW_CONFIDENCE_THRESHOLD = OCR_LOW_CONFIDENCE_THRESHOLD

_ENGINE_ALIASES = {"anthropic": "claude", "google": "gemini"}

# "auto" is not an engine: it means try the configured order (settings.ocr_engine_order).
AUTO_ENGINE = "auto"

_TRANSCRIBE_PROMPT = (
    "You are transcribing a student's handwritten math scratch work, exactly as written. "
    "Do not solve the problem. Do not correct errors. Do not add steps. Transcribe only what is on the page. "
    "Highlighter color, boxes and underlines are not part of the math: leave them out of the transcript "
    "(mention them in LAYOUT) and never write markup such as \\colorbox.\n\n"
    "Return your response as plain text in four sections, separated by lines containing only '---':\n\n"
    "1. TRANSCRIPT: the work in reading order, one step per line. Write words as plain text and wrap every "
    "piece of math in single dollar signs, inline, for example: Since $\\epsilon_4 = 0$, $\\hat{y} = w^T x$. "
    "Never use $$ or \\[ \\]. Never use spacing or positioning commands (\\quad, \\qquad, \\hspace, \\,, ~) "
    "to imitate where things sit on the page: start a new line instead, and describe position in LAYOUT. "
    "An arrow drawn between steps goes inline at the start of the step it points to ($\\Rightarrow$), never "
    "on a line by itself. If a line is crossed out, wrap its math in \\cancel{...} and still include it; a "
    "crossed-out attempt is meaningful information about the student's process, not noise to discard. If "
    "the page has no legible work, write NONE.\n\n"
    "2. LAYOUT: one or two sentences describing spatial structure a linear transcript loses: stacked long "
    "division, matrices, a sketch or number line, which line is boxed or circled as the final answer, "
    "arrows between steps. If nothing spatial matters, write NONE.\n\n"
    "3. LEGIBILITY: one word. high if you read every mark with confidence, medium if you had to guess a "
    "few marks, low if much of the page was guessed or illegible.\n\n"
    "4. NOT WORK: the numbers of the TRANSCRIPT lines (the first line is 1) that are not the student's own "
    "working or answer: lines that only restate the problem or the given information, question or part "
    "headings on their own (Q3], a], (b)), and remarks that are not part of the solution (I ran out of "
    "room, I give up). Comma-separated, for example 1, 2, 5. If every line is working, write NONE.\n"
)

# LEGIBILITY self-rating -> OcrResult.confidence (GH #149). low sits under
# OCR_LOW_CONFIDENCE_THRESHOLD so the answer is held for the student to fix;
# a missing rating keeps the old fixed value.
_LEGIBILITY_CONFIDENCE = {"high": 0.9, "medium": 0.6, "low": 0.25}
_DEFAULT_CONFIDENCE = 0.75

# Spacing/positioning commands a vision model uses to imitate page layout.
# On a messy page they can run away into thousands of \quad tokens until the
# output budget runs out, so they are stripped and a long run marks the read
# as degenerate.
_SPACING_CMD_RE = re.compile(
    r"\\(?:qquad|quad|enspace|enskip|thinspace|hfill|[,;:! ])(?![A-Za-z])|\\[hv]space\*?\{[^{}]*\}"
)
_DISPLAY_DOLLAR_RE = re.compile(r"\$\$(.+?)\$\$", re.DOTALL)
_DISPLAY_BRACKET_RE = re.compile(r"\\\[(.+?)\\\]", re.DOTALL)
_LONE_ARROW_RE = re.compile(
    r"\$?\s*\\(?:uparrow|downarrow|rightarrow|Rightarrow|Downarrow|Uparrow|to|implies|longrightarrow)\s*\$?"
    r"|[↑↓→⇒]"
)
# The same 1-40 character chunk repeated 15+ times in a row: a generation
# loop, not handwriting. Covers "\quad \quad ..." and "= = = ...".
_REPEAT_RE = re.compile(r"(\S.{0,39}?)(?:\s*\1){14,}", re.DOTALL)


def normalize_transcript(text: str) -> str:
    """Clean an OCR transcript into one-step-per-paragraph Markdown with inline math.

    Display math becomes inline (a single symbol in a display block rendered
    as a full-width callout on Results), spacing commands are removed, and each
    line becomes its own paragraph so steps do not run together.
    """
    def _inline(match: re.Match) -> str:
        # A display block may span lines; inline math may not.
        return "$" + " ".join(match.group(1).split()) + "$"

    text = _DISPLAY_DOLLAR_RE.sub(_inline, text)
    text = _DISPLAY_BRACKET_RE.sub(_inline, text)
    text = _SPACING_CMD_RE.sub(" ", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    # A line left holding only dollar signs was nothing but spacing.
    lines = [line for line in lines if line.strip("$ ")]
    # An arrow alone on a line joins the step it points to, instead of
    # rendering as its own paragraph.
    merged: list[str] = []
    pending_arrow = ""
    for line in lines:
        if _LONE_ARROW_RE.fullmatch(line):
            pending_arrow = line
            continue
        merged.append(f"{pending_arrow} {line}" if pending_arrow else line)
        pending_arrow = ""
    if pending_arrow:
        merged.append(pending_arrow)
    return "\n\n".join(merged)


def is_degenerate_transcript(raw: str) -> bool:
    """True when a raw transcript is a generation loop rather than a reading."""
    if len(_SPACING_CMD_RE.findall(raw)) >= 40:
        return True
    if _REPEAT_RE.search(raw):
        return True
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) >= 8:
        most_common = max(lines.count(line) for line in set(lines))
        if most_common >= 6 and most_common * 2 > len(lines):
            return True
    return False


def _normalize_engine(name: Optional[str]) -> str:
    value = (name or AUTO_ENGINE).strip().lower()
    return _ENGINE_ALIASES.get(value, value)


def _strip_label(section: str, label: str) -> str:
    for prefix in (f"{label}:", f"1. {label}:", f"2. {label}:", f"3. {label}:"):
        if section.upper().startswith(prefix):
            return section[len(prefix):].strip()
    return section


def _parse_transcription(raw: str, engine: str) -> OcrResult:
    # Split on a line that is only '---', not any '---' (a transcript can hold
    # a drawn horizontal rule or a long minus run).
    parts = [part.strip() for part in re.split(r"^\s*-{3,}\s*$", raw, maxsplit=3, flags=re.MULTILINE)]
    transcript = _strip_label(parts[0], "TRANSCRIPT")
    layout_raw = _strip_label(parts[1], "LAYOUT") if len(parts) > 1 else ""
    legibility_raw = _strip_label(parts[2], "LEGIBILITY") if len(parts) > 2 else ""
    not_work_raw = _strip_label(parts[3], "NOT WORK") if len(parts) > 3 else ""
    layout_notes = None if not layout_raw or layout_raw.upper() == "NONE" else layout_raw
    answer_work = None
    if not transcript or transcript.upper() == "NONE":
        transcript = ""
    elif is_degenerate_transcript(transcript):
        # A runaway loop (e.g. thousands of \quad) is an unreadable page, not
        # a transcript: empty it so the next engine gets a turn.
        logger.info("OCR engine %s returned a degenerate transcript (%d chars)", engine, len(transcript))
        transcript = ""
    else:
        answer_work = answer_work_lines(transcript, not_work_raw)
        transcript = normalize_transcript(transcript)
    # Neither vision model reports a real confidence score, so the model's own
    # LEGIBILITY word stands in for one (GH #149). A missing or unrecognized
    # word keeps the old fixed value, above the low-confidence floor.
    legibility = legibility_raw.split()[0].strip(".:").lower() if legibility_raw else ""
    confidence = _LEGIBILITY_CONFIDENCE.get(legibility, _DEFAULT_CONFIDENCE) if transcript else 0.0
    return OcrResult(
        transcript=transcript,
        layout_notes=layout_notes,
        confidence=confidence,
        engine=engine,
        answer_work=answer_work,
    )


def answer_work_lines(raw_transcript: str, not_work: str) -> Optional[str]:
    """The student's working only, for showing as their answer (GH #157).

    The reader names the raw lines to drop (restated problem, headings, side
    remarks) by number instead of copying the rest, which would double the
    output against the vision token budget. Only lines that survive into the
    normalized transcript are kept, so the result is always a subset of it.
    None when nothing is dropped or nothing would be left.
    """
    drop = {int(n) for n in re.findall(r"\d+", not_work or "")}
    if not drop:
        return None
    raw_lines = [line for line in raw_transcript.splitlines() if line.strip()]
    kept_raw = [line for i, line in enumerate(raw_lines, start=1) if i not in drop]
    if not kept_raw or len(kept_raw) == len(raw_lines):
        return None
    full = normalize_transcript(raw_transcript).split("\n\n")
    known = set(full)
    kept = [line for line in normalize_transcript("\n".join(kept_raw)).split("\n\n") if line in known]
    if not kept or len(kept) == len(full):
        return None
    return "\n\n".join(kept)


def is_read_from_drawing(answer: str, transcript: Optional[str]) -> bool:
    """Whether a stored answer is (part of) the drawing's transcript rather
    than something the student typed: every paragraph is a transcript line."""
    answer = (answer or "").strip()
    if not answer or not transcript:
        return False
    known = set(transcript.strip().split("\n\n"))
    return all(line in known for line in answer.split("\n\n"))


async def _transcribe_claude(image_b64: str, media_type: str) -> OcrResult:
    raw = await LLMService()._complete_vision_anthropic(image_b64, media_type, _TRANSCRIBE_PROMPT)
    return _parse_transcription(raw, engine="claude")


async def _transcribe_gemini(image_b64: str, media_type: str) -> OcrResult:
    raw = await LLMService()._complete_vision_gemini(image_b64, media_type, _TRANSCRIBE_PROMPT)
    return _parse_transcription(raw, engine="gemini")


# Module-level constant, not a class attribute: CLAUDE.md bans shared mutable
# state on services.
_OCR_ENGINES: dict[str, Callable[[str, str], Awaitable[OcrResult]]] = {
    "claude": _transcribe_claude,
    "gemini": _transcribe_gemini,
}


def _engine_has_key(name: str) -> bool:
    from src.config import settings

    return bool({"claude": settings.anthropic_api_key, "gemini": settings.google_ai_api_key}.get(name))


def _candidate_ocr_engines(requested: Optional[str]) -> list[str]:
    """Engines to try, in order.

    A pinned engine goes first and the rest of the configured order follow it,
    so one provider's outage or rate limit never fails a submission. "auto"
    (the default) is just the configured order, free engine first. Engines
    with no API key are skipped. Never empty: with no keys at all Claude is
    returned so the failure is logged against a real engine.
    """
    from src.config import settings

    order = [
        e for e in (_normalize_engine(part) for part in settings.ocr_engine_order.split(","))
        if e in _OCR_ENGINES
    ]
    for engine in _OCR_ENGINES:
        if engine not in order:
            order.append(engine)
    pinned = _normalize_engine(requested)
    if pinned in _OCR_ENGINES:
        order = [pinned] + [e for e in order if e != pinned]
    keyed = [e for e in order if _engine_has_key(e)]
    return keyed or ["claude"]


class OcrService:
    """Stateless. No constructor state, matching every other service here."""

    async def transcribe(
        self, image_b64: str, engine: Optional[str] = None, media_type: str = "image/png"
    ) -> Optional[OcrResult]:
        """Transcribe one scratch-pad drawing, or return None on any failure.

        Never raises. OCR is a strictly sequential step before grading (see
        ocr-routing.md); a transcription failure must degrade to grading as if
        no drawing had been submitted, never fail the whole submission.
        """
        # A bounded loop over the configured engines, one call each: a failure
        # or an empty read moves on to the next engine (never re-raised, per the
        # provider-loop rule), and only when every engine fails is None returned.
        # A low-legibility read also gives the next engine a turn, since it may
        # read the page better; if none does, the first low read is returned
        # and the caller decides what low legibility means (GH #149).
        best_low: Optional[OcrResult] = None
        for name in _candidate_ocr_engines(engine):
            try:
                result = await _OCR_ENGINES[name](image_b64, media_type)
            except Exception as exc:
                logger.warning("OCR transcription failed (engine=%s): %s", name, exc)
                continue
            if not result.transcript:
                logger.info("OCR engine %s read nothing; trying the next one", name)
                continue
            if result.confidence >= LOW_CONFIDENCE_THRESHOLD:
                return result
            logger.info("OCR engine %s rated the page low legibility; trying the next one", name)
            best_low = best_low or result
        return best_low


def check_ocr_engines_status() -> dict[str, bool]:
    """Key-presence per OCR engine, same shape as check_providers_status().

    Used by the frontend to decide whether to render an engine picker at all;
    with one engine there is nothing to pick, so it stays hidden.
    """
    from src.config import settings

    return {"claude": bool(settings.anthropic_api_key), "gemini": bool(settings.google_ai_api_key)}


def valid_ocr_engines() -> set[str]:
    """The registered engine keys, for resolve_ocr_engine's validation."""
    return set(_OCR_ENGINES.keys())
