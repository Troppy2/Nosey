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

from typing import Awaitable, Callable, Optional

from src.schemas.attempt_schema import OCR_LOW_CONFIDENCE_THRESHOLD, OcrResult
from src.services.llm_service import LLMService
from src.utils.logger import get_logger

logger = get_logger(__name__)

# Re-exported for callers that only import ocr_service (the constant's real
# home is attempt_schema.py, to avoid a circular import with llm_service.py,
# which also needs it and must not import this module).
LOW_CONFIDENCE_THRESHOLD = OCR_LOW_CONFIDENCE_THRESHOLD

_ENGINE_ALIASES = {"anthropic": "claude"}

_TRANSCRIBE_PROMPT = (
    "You are transcribing a student's handwritten math scratch work, exactly as written. "
    "Do not solve the problem. Do not correct errors. Do not add steps. Transcribe only what is on the page.\n\n"
    "Return your response as plain text in two sections, separated by a line containing only '---':\n\n"
    "1. TRANSCRIPT: every line of work, in order, as LaTeX where math notation appears. "
    "If a line is crossed out, wrap it in \\cancel{...} and still include it; a crossed-out attempt is "
    "meaningful information about the student's process, not noise to discard. If the page has no legible "
    "work, write NONE.\n\n"
    "2. LAYOUT: one or two sentences describing spatial structure a linear transcript loses: stacked long "
    "division, matrices, a sketch or number line, which line is boxed or circled as the final answer, "
    "arrows between steps. If nothing spatial matters, write NONE.\n"
)


def _normalize_engine(name: Optional[str]) -> str:
    value = (name or "claude").strip().lower()
    return _ENGINE_ALIASES.get(value, value)


def _parse_transcription(raw: str, engine: str) -> OcrResult:
    parts = raw.split("---", 1)
    transcript = parts[0].strip()
    layout_raw = parts[1].strip() if len(parts) > 1 else ""
    for prefix in ("TRANSCRIPT:", "1. TRANSCRIPT:"):
        if transcript.upper().startswith(prefix):
            transcript = transcript[len(prefix):].strip()
    for prefix in ("LAYOUT:", "2. LAYOUT:"):
        if layout_raw.upper().startswith(prefix):
            layout_raw = layout_raw[len(prefix):].strip()
    layout_notes = None if not layout_raw or layout_raw.upper() == "NONE" else layout_raw
    if not transcript or transcript.upper() == "NONE":
        transcript = ""
    # Claude has no native confidence score for this task; a fixed value that
    # sits above the low-confidence floor reflects that vision transcription
    # of legible handwriting is generally reliable, while leaving room for a
    # future engine (or a future prompt asking Claude to self-report) to
    # report a real per-transcript number.
    confidence = 0.75 if transcript else 0.0
    return OcrResult(transcript=transcript, layout_notes=layout_notes, confidence=confidence, engine=engine)


async def _transcribe_claude(image_b64: str, media_type: str) -> OcrResult:
    raw = await LLMService()._complete_vision_anthropic(image_b64, media_type, _TRANSCRIBE_PROMPT)
    return _parse_transcription(raw, engine="claude")


# Module-level constant, not a class attribute: CLAUDE.md bans shared mutable
# state on services. There is exactly one engine in v1; see
# ocr-routing.md for why a candidate-fallback loop is deliberately not built
# until a second engine exists to inform its ordering.
_OCR_ENGINES: dict[str, Callable[[str, str], Awaitable[OcrResult]]] = {
    "claude": _transcribe_claude,
}


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
        normalized = _normalize_engine(engine)
        adapter = _OCR_ENGINES.get(normalized)
        if adapter is None:
            logger.warning("Unknown OCR engine %r requested; falling back to claude", engine)
            adapter = _OCR_ENGINES["claude"]
            normalized = "claude"
        try:
            return await adapter(image_b64, media_type)
        except Exception as exc:
            logger.warning("OCR transcription failed (engine=%s): %s", normalized, exc)
            return None


def check_ocr_engines_status() -> dict[str, bool]:
    """Key-presence per OCR engine, same shape as check_providers_status().

    Used by the frontend to decide whether to render an engine picker at all;
    with one engine there is nothing to pick, so it stays hidden.
    """
    from src.config import settings

    return {"claude": bool(settings.anthropic_api_key)}


def valid_ocr_engines() -> set[str]:
    """The registered engine keys, for resolve_ocr_engine's validation."""
    return set(_OCR_ENGINES.keys())
