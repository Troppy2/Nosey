"""MCQ truthfulness verification.

See .claude/todos-features/mcq-verification-implementation-plan.md for the
full design. Summary of the architecture (section 2.1 of that plan):

Two LLM calls, never conditional on each other:
  1. LLMService.derive_mcq_answers  — answer each question BLIND to its options.
  2. LLMService.adjudicate_mcq_matches — with the derived answer already fixed,
     decide which option (if any) states it. -1 is a valid, expected verdict.

Then a deterministic matcher (this module) runs as a DROP VETO ONLY: it can
convert a proposed drop into a kept-and-recorrected question, but it can never
itself produce a drop. Fuzzy string matching is the least reliable component in
this design, so it is wired so that being wrong costs at most a kept-but-
questionable question, never a deleted good one.

This module is stateless and does no HTTP; it holds one LLMService for the two
calls above and otherwise only manipulates data already in memory.

Step 3-5 of the build order: this file plus its unit tests, no callers yet.
The over-generation/repair round (step 6-7 of the plan) lands as a later
addition to MCQVerificationService, not a rewrite of it.
"""
from __future__ import annotations

import re
import time
import unicodedata
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from fractions import Fraction
from typing import Optional

from src.services.llm_service import DerivedAnswer, LLMService
from src.utils.logger import get_logger

logger = get_logger(__name__)

# ── confidence thresholds (plan section "Step 5") ────────────────────────────
_MIN_DROP_CONFIDENCE = 0.7
_QUESTIONABLE_FLOOR = 0.4
_MIN_RECORRECT_CONFIDENCE = 0.6

# ── batch-level safety caps ───────────────────────────────────────────────────
_MAX_DROP_FRACTION = 0.5
_MIN_BATCH_FOR_DROPS = 3

# ── matcher thresholds ────────────────────────────────────────────────────────
_SUBSTRING_LENGTH_FLOOR = 0.6
_DICE_MATCH_THRESHOLD = 0.85
_SEQUENCE_MATCH_THRESHOLD = 0.9
_SEQUENCE_MATCH_MAX_LEN = 40

_STOPWORDS = frozenset({
    "the", "a", "an", "of", "is", "are", "to", "in", "for", "and", "or", "that", "it",
})

_NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "hundred": 100, "thousand": 1000,
}

_MARKDOWN_STRIP_RE = re.compile(r"[`*_]+")
_LEADING_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*]|\d+[.)])\s+")
_LEADING_OPTION_LABEL_RE = re.compile(r"^\s*\(?([A-Da-d])[).]\s+")
_LATEX_DELIM_RE = re.compile(r"\$+")
_LATEX_LEFT_RIGHT_RE = re.compile(r"\\left|\\right")
_LATEX_SPACING_RE = re.compile(r"\\[!,;]")
_LATEX_DFRAC_TFRAC_RE = re.compile(r"\\[dt]frac")
_LATEX_CDOT_TIMES_RE = re.compile(r"\\cdot|\\times")
_LATEX_BRACED_POWER_RE = re.compile(r"\^\{(\d+)\}")
_TRAILING_PUNCT_RE = re.compile(r"[.,;:!?]+$")
_SURROUNDING_QUOTES_RE = re.compile(r"^[\"'“”‘’(\[]+|[\"'“”‘’)\]]+$")
_ASSIGNMENT_PREFIX_RE = re.compile(r"^(?:x|y|z|f\(x\)|answer|result)\s*=\s*(?=\S)", re.IGNORECASE)
_LEADING_ARTICLE_RE = re.compile(r"^(?:the|a|an)\s+", re.IGNORECASE)
_WHITESPACE_RE = re.compile(r"\s+")

_PLAIN_FRACTION_RE = re.compile(r"^([+-]?\d+)\s*/\s*(\d+)$")
_LATEX_FRAC_RE = re.compile(r"^\\frac\{([+-]?\d+)\}\{(\d+)\}$")
_PLAIN_NUMBER_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?$")


def normalize_answer_text(text: str, case_sensitive: bool = False) -> str:
    """Normalize a derived answer or an option for comparison.

    Applied identically to the derived answer and to every option, so the
    output only needs to compare equal (or nearly equal) when the two
    genuinely state the same thing. See the plan's "Normalization pipeline"
    for the numbered steps this implements in order.
    """
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKC", text)

    normalized = _MARKDOWN_STRIP_RE.sub("", normalized)
    normalized = _LEADING_LIST_MARKER_RE.sub("", normalized)
    normalized = _LEADING_OPTION_LABEL_RE.sub("", normalized)

    normalized = _LATEX_LEFT_RIGHT_RE.sub("", normalized)
    normalized = _LATEX_SPACING_RE.sub("", normalized)
    normalized = _LATEX_DFRAC_TFRAC_RE.sub(r"\\frac", normalized)
    normalized = _LATEX_DELIM_RE.sub("", normalized)

    if not case_sensitive:
        normalized = normalized.lower()
    normalized = _WHITESPACE_RE.sub(" ", normalized).strip()
    normalized = _TRAILING_PUNCT_RE.sub("", normalized)
    normalized = _SURROUNDING_QUOTES_RE.sub("", normalized).strip()

    stripped_prefix = _ASSIGNMENT_PREFIX_RE.sub("", normalized)
    if stripped_prefix:
        normalized = stripped_prefix
    normalized = _LEADING_ARTICLE_RE.sub("", normalized)

    return normalized.strip()


def _normalize_math_expression(text: str) -> str:
    """Extra math-only normalization, applied on top of normalize_answer_text
    (plan section 4.2). Kept separate so the prose ladder is unaffected."""
    normalized = _LATEX_CDOT_TIMES_RE.sub("*", text)
    normalized = _LATEX_BRACED_POWER_RE.sub(r"^\1", normalized)
    return normalized


def parse_numeric(text: str) -> Optional[Fraction]:
    """Extract a numeric value when the (already-normalized) string is
    entirely a number, decimal, signed number, simple fraction, LaTeX
    \\frac{a}{b}, or a spelled-out number word. None if it is not numeric."""
    if not text:
        return None
    candidate = text.strip()

    word_value = _NUMBER_WORDS.get(candidate.lower())
    if word_value is not None:
        return Fraction(word_value)

    match = _LATEX_FRAC_RE.match(candidate)
    if match:
        numerator, denominator = match.groups()
        try:
            return Fraction(int(numerator), int(denominator))
        except (ValueError, ZeroDivisionError):
            return None

    match = _PLAIN_FRACTION_RE.match(candidate)
    if match:
        numerator, denominator = match.groups()
        try:
            return Fraction(int(numerator), int(denominator))
        except (ValueError, ZeroDivisionError):
            return None

    if _PLAIN_NUMBER_RE.match(candidate):
        try:
            return Fraction(candidate)
        except (ValueError, ZeroDivisionError):
            return None

    return None


def _numeric_match(left: Fraction, right: Fraction) -> bool:
    if left == right:
        return True
    left_f, right_f = float(left), float(right)
    return abs(left_f - right_f) <= 1e-9 * max(1.0, abs(left_f), abs(right_f))


def _dice_coefficient(left_tokens: set[str], right_tokens: set[str]) -> float:
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = len(left_tokens & right_tokens)
    return (2.0 * overlap) / (len(left_tokens) + len(right_tokens))


def _tokenize(text: str) -> set[str]:
    return {tok for tok in text.split() if tok not in _STOPWORDS}


def strings_match(left: str, right: str) -> bool:
    """The string comparison ladder, first hit wins. Both inputs are already
    normalized (see normalize_answer_text)."""
    if not left or not right:
        return False

    if left == right:
        return True

    shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
    if shorter in longer and len(shorter) >= _SUBSTRING_LENGTH_FLOOR * len(longer):
        return True

    dice = _dice_coefficient(_tokenize(left), _tokenize(right))
    if dice >= _DICE_MATCH_THRESHOLD:
        return True

    if len(left) < _SEQUENCE_MATCH_MAX_LEN and len(right) < _SEQUENCE_MATCH_MAX_LEN:
        if SequenceMatcher(None, left, right).ratio() >= _SEQUENCE_MATCH_THRESHOLD:
            return True

    return False


def answers_match(derived_answer: str, option: str, variant: str = "prose") -> bool:
    """True when the derived answer and one option state the same thing.

    Tries numeric comparison first (so "$\\frac{1}{2}$" matches "0.5"), then
    falls back to the string ladder. The coding variant compares case
    sensitively, since program output is case sensitive.
    """
    case_sensitive = variant == "coding"
    normalized_answer = normalize_answer_text(derived_answer, case_sensitive=case_sensitive)
    normalized_option = normalize_answer_text(option, case_sensitive=case_sensitive)
    if variant == "math":
        normalized_answer = _normalize_math_expression(normalized_answer)
        normalized_option = _normalize_math_expression(normalized_option)

    answer_value = parse_numeric(normalized_answer)
    option_value = parse_numeric(normalized_option)
    if answer_value is not None and option_value is not None:
        return _numeric_match(answer_value, option_value)
    if answer_value is not None or option_value is not None:
        # One side is numeric, the other is not: never a numeric match, and the
        # string ladder below is unlikely to help either, but let it try.
        pass

    return strings_match(normalized_answer, normalized_option)


def veto_drop(derived_answer: str, options: list[str], variant: str = "prose") -> Optional[int]:
    """The drop-veto matcher. Returns an option index ONLY when exactly one
    option clearly states the derived answer; otherwise returns None (no
    veto). This function can never assert "no option matches" — it is silent
    in that case, never a drop verdict. See the module docstring.
    """
    matches = [index for index, option in enumerate(options) if answers_match(derived_answer, option, variant)]
    if len(matches) == 1:
        return matches[0]
    return None


# ── decision table types ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class VerifiableMCQ:
    """Adapter so the service works on any MCQ-shaped object without
    special-casing GeneratedMCQ, a DB row, or a module quiz dict. key is the
    caller's own handle (a list position, a DB row id, ...) and is returned
    unchanged so the caller can map results back to its own objects."""
    key: object
    question_text: str
    options: list[str]
    correct_index: int


@dataclass(frozen=True)
class VerificationOutcome:
    kept: list[VerifiableMCQ]
    dropped_keys: list[object]
    stats: dict[str, object]


class MCQVerificationService:
    """Stateless orchestrator: derive, adjudicate, veto, decide, cap."""

    def __init__(self, llm: Optional[LLMService] = None) -> None:
        self._llm = llm if llm is not None else LLMService()

    @staticmethod
    def _resolve_item(
        original: VerifiableMCQ,
        derived: Optional[DerivedAnswer],
        matched: Optional[int],
        veto_index: Optional[int],
    ) -> tuple[str, Optional[int]]:
        """One item's verdict. Returns (verdict, new_index) where verdict is
        one of "keep", "recorrect", "drop", "questionable". new_index is only
        meaningful for "recorrect" (and is the veto index for a vetoed drop).

        Evaluated top to bottom, first match wins — mirrors the plan's
        decision table in Step 5 exactly.
        """
        if derived is None:
            return "keep", None
        if not derived.derivable:
            return "keep", None
        if matched is None:
            return "keep", None

        if matched == -1:
            if veto_index is not None:
                return "recorrect", veto_index
            if derived.confidence >= _MIN_DROP_CONFIDENCE:
                return "drop", None
            if derived.confidence >= _QUESTIONABLE_FLOOR:
                return "questionable", None
            return "keep", None

        if matched == original.correct_index:
            return "keep", None
        if derived.confidence >= _MIN_RECORRECT_CONFIDENCE:
            return "recorrect", matched
        if derived.confidence >= _QUESTIONABLE_FLOOR:
            return "questionable", None
        return "keep", None

    async def verify_and_resolve(
        self,
        items: list[VerifiableMCQ],
        source_content: str,
        variant: str = "prose",
        provider: Optional[str] = None,
        coding_language: Optional[str] = None,
    ) -> VerificationOutcome:
        """Run both LLM calls, the veto pass, the decision table, and the
        batch-level safety caps. Never raises: any internal failure surfaces
        as every item kept unchanged (see the per-call fail-open behavior in
        LLMService.derive_mcq_answers / adjudicate_mcq_matches).
        """
        start = time.monotonic()
        stats: dict[str, object] = {
            "verified": len(items),
            "kept": 0,
            "recorrected": 0,
            "dropped": 0,
            "questionable": 0,
            "vetoed": 0,
            "undecided": 0,
            "distrusted": False,
            "calls": 0,
            "duration_ms": 0,
            "variant": variant,
        }

        if not items:
            stats["duration_ms"] = int((time.monotonic() - start) * 1000)
            return VerificationOutcome(kept=[], dropped_keys=[], stats=stats)

        questions = [item.question_text for item in items]
        derived_answers = await self._llm.derive_mcq_answers(
            questions, source_content, variant=variant, provider=provider, coding_language=coding_language,
        )
        stats["calls"] = 1 if questions else 0
        derived_by_index = {d.index: d for d in derived_answers}

        # Skip adjudication entirely when nothing is derivable enough to matter —
        # spending a call to learn "nothing to adjudicate" is waste.
        adjudicate_items = [
            {
                "index": index,
                "question": item.question_text,
                "answer": derived_by_index[index].answer,
                "options": item.options,
            }
            for index, item in enumerate(items)
            if index in derived_by_index and derived_by_index[index].derivable
        ]
        matches: dict[int, int] = {}
        if adjudicate_items:
            matches = await self._llm.adjudicate_mcq_matches(adjudicate_items, provider=provider)
            stats["calls"] = int(stats["calls"]) + 1

        verdicts: list[tuple[str, Optional[int]]] = []
        for index, item in enumerate(items):
            derived = derived_by_index.get(index)
            matched = matches.get(index)
            veto_index: Optional[int] = None
            if matched == -1 and derived is not None:
                veto_index = veto_drop(derived.answer, item.options, variant)
            verdict, new_index = self._resolve_item(item, derived, matched, veto_index)
            if verdict == "recorrect" and matched == -1 and veto_index is not None:
                stats["vetoed"] = int(stats["vetoed"]) + 1
            if derived is None or matched is None:
                stats["undecided"] = int(stats["undecided"]) + 1
            verdicts.append((verdict, new_index))

        # Small-batch guard: fewer than _MIN_BATCH_FOR_DROPS questions cannot
        # absorb a drop, so downgrade any proposed drop to a keep.
        if len(items) < _MIN_BATCH_FOR_DROPS:
            verdicts = [("keep", None) if v == "drop" else (v, i) for v, i in verdicts]

        proposed_drops = sum(1 for verdict, _ in verdicts if verdict == "drop")

        # Batch-level distrust cap: if the verifier wants to drop more than half
        # the batch, it is more likely broken or misgrounded than right. Discard
        # the ENTIRE verification result (drops and recorrections both) rather
        # than trust a derivation this unreliable. See the plan's lineage note
        # to the _is_valid_math_mcq "0 valid questions" incident.
        if items and (proposed_drops / len(items)) > _MAX_DROP_FRACTION:
            logger.warning(
                "MCQ verification distrusted: %d/%d items proposed for drop exceeds "
                "the %.0f%% cap; keeping every question unchanged.",
                proposed_drops, len(items), _MAX_DROP_FRACTION * 100,
            )
            stats["distrusted"] = True
            stats["kept"] = len(items)
            stats["duration_ms"] = int((time.monotonic() - start) * 1000)
            return VerificationOutcome(kept=list(items), dropped_keys=[], stats=stats)

        kept: list[VerifiableMCQ] = []
        dropped_keys: list[object] = []
        for item, (verdict, new_index) in zip(items, verdicts):
            if verdict == "drop":
                dropped_keys.append(item.key)
                stats["dropped"] = int(stats["dropped"]) + 1
            elif verdict == "recorrect":
                kept.append(replace(item, correct_index=new_index))  # type: ignore[arg-type]
                stats["recorrected"] = int(stats["recorrected"]) + 1
                stats["kept"] = int(stats["kept"]) + 1
            elif verdict == "questionable":
                kept.append(item)
                stats["questionable"] = int(stats["questionable"]) + 1
                stats["kept"] = int(stats["kept"]) + 1
            else:
                kept.append(item)
                stats["kept"] = int(stats["kept"]) + 1

        stats["duration_ms"] = int((time.monotonic() - start) * 1000)
        return VerificationOutcome(kept=kept, dropped_keys=dropped_keys, stats=stats)
