"""Split an uploaded practice test into problems a student can pick from.

A 74-page worksheet recreated whole was 127 questions, most of them unwanted.
Create Test lists the problems found here (number, title, first lines) and
only the chosen ones are sent to the AI, so picking 5 parses 5.

Plain text rules, no LLM: problems in exams and worksheets start with a few
fixed heading shapes. A document with no recognizable problem headings gets an
AI index pass instead (LLMService.index_practice_problems), which reuses
problems_from_starts below to turn its answer into the same ranges.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Optional, Sequence

from src.services.practice_sections import _answer_key_start

# "### 1.1 Vector equations", "## C2.A Deviation ...", "### Problem 3 Title".
_HEADING_PROBLEM_RE = re.compile(
    r"^\s*#{1,6}\s*\**\s*(?:(?:problem|question|exercise|q)\s*)?"
    r"(\d{1,3}(?:\.\d{1,3})*[a-z]?|[A-Z]\d{0,2}\.[A-Z0-9]{1,3})[.):]?\**(?:\s+(.*))?$",
    re.IGNORECASE,
)
# "Problem 3", "Question 4.2: ...", "Exercise 7 (10 points)".
_NAMED_PROBLEM_RE = re.compile(
    r"^\s*\**\s*(?:problem|question|exercise)\s+(\d{1,3}(?:\.\d{1,3})*)\**[.):]?(?:\s+(.*))?$",
    re.IGNORECASE,
)
# "1. What is ...", "12) Find ...": top-level numbering only.
_NUMBERED_PROBLEM_RE = re.compile(r"^\s*\**\s*(\d{1,3})[.)]\**\s+(\S.*)$")
# "# Chapter 1", "Part II", "Section 3": groups problems in the picker.
_CHAPTER_RE = re.compile(
    r"^\s*#{0,4}\s*\**\s*((?:chapter|part|section|unit|module)\s+(?:\d+|[ivxlc]+))\b",
    re.IGNORECASE,
)
_TOC_LINE_RE = re.compile(r"^.*?(?:\s*\.){5,}\s*\d+\s*$")
# A lettered part: "(a) ...", "- (b) ...", "a) ...".
_PART_RE = re.compile(r"^\s*[-*]?\s*\(?([a-h])\)(?:\s+|$)")
# Worksheet labels after a title ("PRIORITY", "SEEN IN HW"): a trailing run of
# all-caps words, cut so the picker and the parser see only the title.
_TRAILING_CAPS_RE = re.compile(r"(?:\s+[A-Z]{2,}\b)+\s*$")
_PREVIEW_CHARS = 220
# "1. What is the molarity of ..." puts the whole question on the heading line.
_TITLE_CHARS = 90
# A document with fewer problems than this gets no picker.
MIN_PROBLEMS = 2
MAX_PROBLEMS = 400


@dataclass(frozen=True)
class PracticeProblem:
    index: int
    label: str
    title: str
    chapter: Optional[str]
    preview: str
    part_count: int
    start: int
    end: int


def _lines_with_offsets(text: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    offset = 0
    for line in text.splitlines(keepends=True):
        out.append((offset, line.rstrip("\r\n")))
        offset += len(line)
    return out


def _footer_keys(lines: Sequence[tuple[int, str]]) -> set[str]:
    """Page headers/footers: a line repeated 3+ times once its page number is dropped."""
    counts = Counter(
        key for _, line in lines if (key := re.sub(r"\s*\d+\s*$", "", line.strip())) and len(key) >= 6
    )
    return {key for key, n in counts.items() if n >= 3}


def _is_footer(line: str, footers: set[str]) -> bool:
    return re.sub(r"\s*\d+\s*$", "", line.strip()) in footers


def clean_title(title: str) -> str:
    title = re.sub(r"[*_#]+", " ", title or "")
    title = " ".join(title.split())
    stripped = _TRAILING_CAPS_RE.sub("", title).strip()
    # A title that is only capitals ("TRUE OR FALSE") is a title, not a label.
    if not stripped or stripped.upper() == stripped:
        stripped = title
    if len(stripped) > _TITLE_CHARS:
        stripped = stripped[:_TITLE_CHARS].rsplit(" ", 1)[0] + "..."
    return stripped


def problem_text(text: str, start: int, end: int) -> str:
    """One problem's text with page footers and worksheet labels removed."""
    lines = _lines_with_offsets(text)
    footers = _footer_keys(lines)
    body = [line for off, line in lines if start <= off < end and not _is_footer(line, footers)]
    if body:
        body[0] = _TRAILING_CAPS_RE.sub("", body[0].rstrip())
        # The tail of a label wrapped onto the next line ("PRI" / "ORITY").
        if len(body) > 1 and re.fullmatch(r"\s*[A-Z]{2,12}\s*", body[1]):
            body.pop(1)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(body)).strip()


def _match_heads(lines: Sequence[tuple[int, str]], key_start: int) -> list[tuple[int, str, str]]:
    """(offset, label, title) for the most specific heading style with 2+ hits."""
    usable = [(o, line) for o, line in lines if o < key_start and not _TOC_LINE_RE.match(line)]
    for pattern in (_HEADING_PROBLEM_RE, _NAMED_PROBLEM_RE):
        heads = [
            (o, m.group(1), m.group(2) or "")
            for o, line in usable
            if (m := pattern.match(line))
        ]
        if len(heads) >= MIN_PROBLEMS:
            return heads
    # Plain "1." numbering also matches numbered steps inside answers, so keep
    # only an ascending run: each kept number is the previous one plus one.
    heads = []
    expected: Optional[int] = None
    for o, line in usable:
        m = _NUMBERED_PROBLEM_RE.match(line)
        if not m:
            continue
        number = int(m.group(1))
        if expected is None or number == expected:
            heads.append((o, m.group(1), m.group(2)))
            expected = number + 1
    return heads


def problems_from_starts(text: str, starts: Sequence[tuple[int, str, str]]) -> list[PracticeProblem]:
    """Build problems from (offset, label, title) starts, in document order."""
    lines = _lines_with_offsets(text)
    footers = _footer_keys(lines)
    key_start = _answer_key_start(text)
    starts = sorted({o: (o, l, t) for o, l, t in starts if 0 <= o < key_start}.values())
    if len(starts) < MIN_PROBLEMS:
        return []
    chapters = [
        (o, m.group(1).strip().title())
        for o, line in lines
        if (m := _CHAPTER_RE.match(line)) and not _TOC_LINE_RE.match(line)
    ]
    chapter_offsets = [o for o, _ in chapters]
    problems: list[PracticeProblem] = []
    for n, (start, label, title) in enumerate(starts[:MAX_PROBLEMS]):
        end = starts[n + 1][0] if n + 1 < len(starts) else key_start
        # A chapter heading between two problems ends the earlier one.
        end = min([end] + [o for o in chapter_offsets if start < o < end])
        chapter = None
        for o, name in chapters:
            if o <= start:
                chapter = name
        body_lines = [
            line for off, line in lines
            if start < off < end and line.strip() and not _is_footer(line, footers)
        ]
        if body_lines and re.fullmatch(r"\s*[A-Z]{2,12}\s*", body_lines[0]):
            body_lines = body_lines[1:]
        # A question written on its heading line ("3. Ionic bonds ...") has no
        # body, so the heading's own text is the preview.
        preview = " ".join(" ".join(body_lines).split()) or " ".join(clean_title(title).split())
        if len(preview) > _PREVIEW_CHARS:
            preview = preview[:_PREVIEW_CHARS].rsplit(" ", 1)[0] + "..."
        parts = {m.group(1) for line in body_lines if (m := _PART_RE.match(line))}
        problems.append(PracticeProblem(
            index=len(problems),
            label=label,
            title=clean_title(title),
            chapter=chapter,
            preview=preview,
            part_count=len(parts),
            start=start,
            end=end,
        ))
    return problems


def split_problems(text: str) -> list[PracticeProblem]:
    """The document's problems in order, or [] when it has no clear headings."""
    text = text or ""
    lines = _lines_with_offsets(text)
    heads = _match_heads(lines, _answer_key_start(text))
    problems = problems_from_starts(text, heads)
    # A heading with nothing under it is a table-of-contents or cover line.
    problems = [p for p in problems if p.preview]
    return [
        PracticeProblem(i, p.label, p.title, p.chapter, p.preview, p.part_count, p.start, p.end)
        for i, p in enumerate(problems)
    ] if len(problems) >= MIN_PROBLEMS else []


def answer_key_text(text: str) -> str:
    return (text or "")[_answer_key_start(text or ""):].strip()
