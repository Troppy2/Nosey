"""Turn state and reply hygiene for the mock interview chats (GH #221).

The server owns each round's progress. Every turn the model only judges whether the
candidate's latest message finished the question it was asked last turn; the
functions here turn that judgment into coverage. Before #221 the model reported the
covered goals itself and the server trusted the report, so a round both looped
(the model never reported a goal, or was told to ask the goal just answered) and
skipped (it reported goals that were never asked).

Also here: scrubbing prompt scaffolding out of replies, and withholding a coding
problem's constraints and follow-up from the candidate's screen.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Optional

from src.schemas.mock_interview_schema import CodingProblemInfo


# ── Turn state ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TurnPlan:
    """What this turn is about, decided before the model is called."""

    current: Optional[str]  # the goal asked last turn, now being answered (None: all covered)
    next: Optional[str]  # the goal to move to once current is done (None: current is the last)
    must_advance: bool  # follow-up budget spent: move on whatever the answer was


@dataclass(frozen=True)
class TurnResult:
    covered: list[str]
    followups: int  # non-advancing answers on the (new) current goal
    advanced: bool


def normalize_covered(covered: Optional[list[str]], goals: list[str]) -> list[str]:
    """Known goals only, in canonical order."""
    seen = {g for g in (covered or []) if isinstance(g, str)}
    return [g for g in goals if g in seen]


def plan_turn(covered: list[str], goals: list[str], followups: int, cap: int) -> TurnPlan:
    remaining = [g for g in goals if g not in covered]
    current = remaining[0] if remaining else None
    nxt = remaining[1] if len(remaining) > 1 else None
    return TurnPlan(current=current, next=nxt, must_advance=current is not None and followups >= cap)


def resolve_turn(
    plan: TurnPlan, covered: list[str], goals: list[str], followups: int, *, answered_turn: bool, judged_done: bool
) -> TurnResult:
    """Advance exactly one goal when the candidate's message finished the current one,
    or when its follow-up budget is spent. Nothing else moves coverage."""
    if not answered_turn or plan.current is None:
        return TurnResult(covered=list(covered), followups=followups, advanced=False)
    if judged_done or plan.must_advance:
        return TurnResult(covered=normalize_covered(covered + [plan.current], goals), followups=0, advanced=True)
    return TurnResult(covered=list(covered), followups=followups + 1, advanced=False)


def model_flag(parsed: dict, *keys: str) -> bool:
    """A boolean the model returned, tolerating "true"/"false" strings."""
    for key in keys:
        value = parsed.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ("true", "yes", "1")
    return False


# ── Reply hygiene ─────────────────────────────────────────────────────────────

# Internal goal ids. None of them may reach the candidate (session 113 showed
# "impact_metrics: <question>" and "tech_choice: <question>").
_GOAL_WORDS = {
    "background": "background",
    "coding_problem": "problem",
    "approach": "approach",
    "complexity": "complexity",
    "optimize": "follow-up",
    "dry_run": "dry run",
    "questions": "questions",
    "project_deep_dive": "project",
    "impact_metrics": "impact",
    "tech_choice": "tech choice",
    "ownership": "ownership",
    "gap_probe": "gap",
}
_SNAKE_IDS = [g for g in _GOAL_WORDS if "_" in g] + [r"behavioral_q\d"]
_ALL_IDS = list(_GOAL_WORDS) + [r"behavioral_q\d"]
_LABEL_RE = re.compile(r"(?<![\w-])(?:%s)\s*:\s*" % "|".join(_ALL_IDS), re.I)
_SNAKE_RE = re.compile(r"\b(?:%s)\b" % "|".join(_SNAKE_IDS), re.I)
# Prompt rules copied into a reply ("One sentence acknowledging the previous answer,
# then the NEXT uncovered question."). A sentence with any of these is dropped.
_INSTRUCTION_RE = re.compile(
    r"uncovered question|covered[_ ]goals?|goal slot|\bthis turn\b|acknowledging the previous answer|"
    r"one question per turn|step_done|is_followup|is_done|raw json|\b(?:next|current|remaining) (?:goal|step)\b|"
    r"\bgoals? (?:we(?:'re| are)|i(?:'m| am)) (?:checking|covering|tracking)",
    re.I,
)
# "the optimize goal" -> "the follow-up" inside a sentence worth keeping.
_GOAL_PHRASE_RE = re.compile(
    r"\bthe (optimi[sz]e|complexity|approach|dry[ _]run|background|questions?) (?:goal|step)\b", re.I
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _goal_phrase(match: re.Match) -> str:
    word = match.group(1).lower().replace(" ", "_")
    if word.startswith("optimi"):
        return "the follow-up"
    if word == "dry_run":
        return "the dry run"
    if word.startswith("question"):
        return "your questions"
    return f"the {word}"


def scrub_reply(text: str) -> str:
    """Remove prompt scaffolding (goal ids, rule lines) from an interviewer reply.
    Questions are never dropped, only cleaned."""
    if not text:
        return ""
    kept: list[str] = []
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        sentences = []
        for sentence in _SENTENCE_SPLIT_RE.split(paragraph.strip()):
            if not sentence:
                continue
            if "?" not in sentence and _INSTRUCTION_RE.search(sentence):
                continue
            if "?" in sentence and _INSTRUCTION_RE.search(sentence):
                # A rule sentence glued to a real question: keep from the question on.
                sentence = _strip_rule_lead(sentence)
            sentence = _LABEL_RE.sub("", sentence)
            sentence = _GOAL_PHRASE_RE.sub(_goal_phrase, sentence)
            sentence = _SNAKE_RE.sub(lambda m: _GOAL_WORDS.get(m.group(0).lower(), "question"), sentence)
            sentence = re.sub(r"\s{2,}", " ", sentence).strip()
            if sentence:
                sentences.append(sentence)
        if sentences:
            kept.append(" ".join(sentences))
    return "\n\n".join(kept).strip()


def _strip_rule_lead(sentence: str) -> str:
    """'..., then the NEXT uncovered question. tech_choice: On the site, how ...?' arrives
    as one sentence when the model drops the period; keep the part after the last rule hit."""
    last = None
    for last in _INSTRUCTION_RE.finditer(sentence):
        pass
    if last is None:
        return sentence
    tail = sentence[last.end():]
    # Skip to the start of the next clause (after a period, colon or the label).
    cut = re.search(r"[.:]\s*", tail)
    return tail[cut.end():] if cut else tail


# ── Withheld problem details ──────────────────────────────────────────────────

def html_to_plain(markup: str) -> str:
    text = re.sub(r"<(br|/p|/li|/pre|/div)[^>]*>", "\n", markup or "", flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# A sentence that tells the candidate the target complexity ("You must implement a
# solution with linear runtime complexity and use only constant extra space.") or
# asks the follow-up up front. Real interviewers hold these back.
_REQUIREMENT_RE = re.compile(
    r"^\s*(?:you must|your (?:solution|algorithm) (?:must|should)|could you|can you)\b.*"
    r"(?:complexity|extra\s+space|constant\s+space|\bO\()",
    re.I | re.S,
)
_HIDDEN_HEADING = re.compile(r"^(?:constraints?|follow[\s-]*ups?)\b", re.I)
_HTML_HEADING_RE = re.compile(r"<p>\s*<strong[^>]*>\s*([^<]+?)\s*</strong>", re.I)
_HTML_PARA_RE = re.compile(r"<p>(?:(?!</p>).)*</p>", re.I | re.S)


def _split_html(markup: str) -> tuple[str, list[str]]:
    hidden: list[str] = []
    headings = list(_HTML_HEADING_RE.finditer(markup))
    cuts: list[tuple[int, int]] = []
    for i, h in enumerate(headings):
        if _HIDDEN_HEADING.match(html.unescape(h.group(1)).strip()):
            end = headings[i + 1].start() if i + 1 < len(headings) else len(markup)
            cuts.append((h.start(), end))
    visible = markup
    for start, end in reversed(cuts):
        hidden.insert(0, html_to_plain(markup[start:end]))
        visible = visible[:start] + visible[end:]

    def _drop_requirement(m: re.Match) -> str:
        plain = html_to_plain(m.group(0))
        if _REQUIREMENT_RE.match(plain):
            hidden.append(plain)
            return ""
        return m.group(0)

    visible = _HTML_PARA_RE.sub(_drop_requirement, visible)
    return visible.strip(), hidden


# Sections that end a hidden block ("Examples" too: generated problems put
# **Constraints** before **Examples**).
_VISIBLE_HEADING = re.compile(r"^(?:examples?|notes?|inputs?|outputs?|explanation)\b", re.I)


def _text_heading(line: str) -> str:
    """The heading a markdown/plain line starts, or "": "**Constraints**",
    "## Follow-up", "Constraints:", "*Example 1*"."""
    raw = line.strip()
    stripped = raw.strip("*_#").strip()
    if ":" in stripped:
        return stripped.split(":", 1)[0].strip()
    if raw.startswith(("#", "**", "*", "__")) and not raw.startswith("* ") and len(stripped) <= 40:
        return stripped
    return ""


def _split_text(text: str) -> tuple[str, list[str]]:
    hidden: list[str] = []
    visible_lines: list[str] = []
    hidden_block: list[str] = []
    hiding = False
    in_fence = False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            # Never a heading, and a section only changes outside code, so a cut can
            # never leave an unbalanced fence (that turned the rest of the statement
            # into one faint code block).
            in_fence = not in_fence
            (hidden_block if hiding else visible_lines).append(line)
            continue
        heading = "" if in_fence else _text_heading(line)
        if heading and _HIDDEN_HEADING.match(heading):
            if hidden_block:
                hidden.append("\n".join(hidden_block).strip())
            hidden_block = [line]
            hiding = True
            continue
        if hiding and heading and _VISIBLE_HEADING.match(heading):
            hidden.append("\n".join(hidden_block).strip())
            hidden_block = []
            hiding = False
        (hidden_block if hiding else visible_lines).append(line)
    if hidden_block:
        hidden.append("\n".join(hidden_block).strip())

    paragraphs = re.split(r"\n\s*\n", "\n".join(visible_lines))
    kept = []
    for p in paragraphs:
        if "```" not in p and _REQUIREMENT_RE.match(p.strip().strip("*_")):
            hidden.append(p.strip())
        else:
            kept.append(p)
    return "\n\n".join(kept).strip(), [h for h in hidden if h]


def withhold_problem_details(problem: CodingProblemInfo) -> CodingProblemInfo:
    """The candidate's screen gets the statement and examples only. Constraints, the
    follow-up and any stated target complexity move to interviewer_notes, which Kojo
    reveals only when asked (like a real phone screen). Idempotent."""
    if problem.interviewer_notes:
        return problem
    prompt, hidden = _split_text(problem.prompt or "")
    prompt_html = problem.prompt_html or ""
    if prompt_html:
        prompt_html, html_hidden = _split_html(prompt_html)
        # The plain prompt is derived from the same HTML; prefer whichever found more.
        if len("\n".join(html_hidden)) > len("\n".join(hidden)):
            hidden = html_hidden
    if not hidden:
        return problem
    return problem.model_copy(
        update={
            "prompt": prompt or problem.prompt,
            "prompt_html": prompt_html,
            "interviewer_notes": "\n\n".join(hidden)[:8000],
        }
    )
