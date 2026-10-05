"""Find the sections of an uploaded practice test so a student can pick some.

A long document (a 14-chapter homework set, a final with six parts) recreated
whole turns into hundreds of questions. Create Test lists the sections found
here as checkboxes and only the chosen ones are parsed (GH #133).

Pure text functions, no LLM: headings in exams and problem sets follow a few
fixed patterns, and a wrong guess only means the student sees no picker and
gets the whole document, which is the old behavior.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Sequence

# "Chapter 3 - Norm and distance", "PART II  TRUE/FALSE", "Section 4.2 ...", "Unit 5".
_NAMED_HEADING_RE = re.compile(
    r"^\s*#{0,4}\s*((?:chapter|part|section|unit|module)\s+(?:\d+(?:\.\d+)*|[ivxlc]+)\b.{0,90})$",
    re.IGNORECASE,
)
_MARKDOWN_HEADING_RE = re.compile(r"^\s*#{1,2}\s+(.{2,90})$")
# Table-of-contents lines: "1.2 Vector notation . . . . . . 8".
_TOC_LINE_RE = re.compile(r"^.*?(?:\s*\.){5,}\s*\d+\s*$")
# A numbered question or exercise: "1. What is", "1.4 Periodic energy usage", "12) Find",
# also as a markdown heading ("### 1.1 Vector equations", GH #138).
_QUESTION_LINE_RE = re.compile(r"^\s*(?:#{1,6}\s*)?(?:_{2,}\s*)?\d{1,3}(?:\.\d{1,3})?[.)]?\s+[A-Za-z(\[]")
# An answer key heading near the end of the document ("Answer Key", "Answers:").
_ANSWER_KEY_RE = re.compile(
    r"(?im)^[ \t]*(?:#+[ \t]*)?(?:answer[ \t]*key|answers|solutions)\b[^\n]{0,40}$"
)
# Only shown when a document has at least this many usable sections.
MIN_SECTIONS = 2


@dataclass(frozen=True)
class PracticeSection:
    index: int
    title: str
    question_count: int
    start: int
    end: int


def _lines_with_offsets(text: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    offset = 0
    for line in text.splitlines(keepends=True):
        out.append((offset, line.rstrip("\r\n")))
        offset += len(line)
    return out


def _heading_title(line: str, named_only: bool) -> Optional[str]:
    if _TOC_LINE_RE.match(line):
        return None
    match = _NAMED_HEADING_RE.match(line)
    if match:
        return match.group(1).strip(" #*")
    if not named_only:
        match = _MARKDOWN_HEADING_RE.match(line)
        if match:
            return match.group(1).strip(" #*")
    return None


def _answer_key_start(text: str) -> int:
    """Where a trailing answer key begins, or len(text) when there is none."""
    matches = list(_ANSWER_KEY_RE.finditer(text))
    if matches and matches[-1].start() >= len(text) * 0.4:
        return matches[-1].start()
    return len(text)


def detect_sections(text: str) -> list[PracticeSection]:
    """The document's sections that contain numbered questions, in order.

    Named headings (Chapter/Part/Section/Unit) win when there are at least two;
    otherwise top-level markdown headings are used. A section with no numbered
    question (a table of contents, a cover page) is left out. Fewer than
    MIN_SECTIONS results means no picker.
    """
    lines = _lines_with_offsets(text or "")
    named = [(o, t) for o, line in lines if (t := _heading_title(line, named_only=True))]
    headings = named if len(named) >= MIN_SECTIONS else [
        (o, t) for o, line in lines if (t := _heading_title(line, named_only=False))
    ]
    if not headings:
        return []

    # The answer key belongs to every section, so it is cut out of the last one
    # (its lines would count as questions) and added back by slice_sections.
    key_start = _answer_key_start(text)
    headings = [(o, t) for o, t in headings if o < key_start]
    if not headings:
        return []
    sections: list[PracticeSection] = []
    bounds = [o for o, _ in headings] + [key_start]
    for (start, title), end in zip(headings, bounds[1:]):
        body = text[start:end]
        count = sum(
            1 for line in body.splitlines()[1:]
            if _QUESTION_LINE_RE.match(line) and not _TOC_LINE_RE.match(line)
        )
        if count:
            sections.append(PracticeSection(len(sections), title, count, start, end))
    return sections if len(sections) >= MIN_SECTIONS else []


def slice_sections(text: str, indices: Sequence[int]) -> str:
    """Only the chosen sections' text, in document order.

    Unknown indices are ignored; no usable choice returns the whole text, so a
    stale or tampered request degrades to the old behavior instead of failing.
    """
    sections = detect_sections(text)
    chosen = sorted({i for i in indices if 0 <= i < len(sections)})
    if not chosen:
        return text
    parts = [text[sections[i].start:sections[i].end].strip() for i in chosen]
    answer_key = text[_answer_key_start(text):].strip()
    if answer_key:
        parts.append(answer_key)
    return "\n\n".join(parts)
