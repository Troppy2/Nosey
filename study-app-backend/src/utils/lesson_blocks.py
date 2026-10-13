"""Lesson block splitting shared with the frontend's narration highlight.

Mirrors splitLessonBlocks() in study-app-frontend/src/pages/LearningModuleLesson.tsx.
The narration script is stored as one spoken entry per block, and the lesson
page highlights block i while entry i plays, so both sides must cut the
article in exactly the same places. Change one, change the other.
"""

import json
import re
from typing import Optional

_FENCE = re.compile(r"^\s*```")
_HEADING = re.compile(r"^\s*#{1,6}\s")


def split_lesson_blocks(markdown: str) -> list[str]:
    """Split on blank lines, keeping fenced code and $$ display maths whole."""
    blocks: list[str] = []
    current: list[str] = []
    in_fence = False
    in_math = False
    for line in markdown.split("\n"):
        if _FENCE.match(line):
            in_fence = not in_fence
        if not in_fence:
            # A heading inside display maths means the $$ was never closed.
            if in_math and _HEADING.match(line):
                in_math = False
                if current:
                    blocks.append("\n".join(current))
                    current = []
            elif line.count("$$") % 2 == 1:
                in_math = not in_math
        if not in_fence and not in_math and line.strip() == "":
            if current:
                blocks.append("\n".join(current))
                current = []
        else:
            current.append(line)
    if current:
        blocks.append("\n".join(current))
    return blocks


def numbered_blocks(markdown: str) -> str:
    """The lesson as [1] ... [N] blocks, for prompts that map entries to blocks."""
    return "\n\n".join(f"[{i + 1}]\n{block}" for i, block in enumerate(split_lesson_blocks(markdown)))


def normalize_tts_script(raw: object) -> str:
    """Store a narration script as text.

    A list (one spoken entry per lesson block) is kept as a JSON array so the
    frontend can map entry i to block i. A plain string is the legacy format
    and is stored unchanged.
    """
    if isinstance(raw, list):
        entries = [str(item or "").strip() for item in raw]
        # ensure_ascii=False stores dashes and accents as themselves, not as
        # backslash-u escapes: shorter, and readable in the database.
        return json.dumps(entries, ensure_ascii=False) if any(entries) else ""
    return str(raw or "").strip()


def tts_entry_count(script: Optional[str]) -> Optional[int]:
    """Number of entries in a JSON-array script, or None for the legacy format."""
    if not script or not script.startswith("["):
        return None
    try:
        data = json.loads(script)
    except ValueError:
        return None
    return len(data) if isinstance(data, list) else None
