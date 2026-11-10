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


# ── Practice scratch pads ────────────────────────────────────────────────────
# A lesson can hold practice problems: the author puts SCRATCHPAD_MARKER on a
# line of its own (a paragraph of its own) right after a problem statement.
# The reader shows a scratch pad there, and every block after the marker, up
# to the next heading, horizontal rule, marker or the end of the lesson, is the
# walkthrough, kept collapsed until the problem is solved or given up. Mirrors
# isScratchpadBlock / practiceLayout in study-app-frontend/src/lib/practicePads.ts.
SCRATCHPAD_MARKER = "[[scratchpad]]"
MAX_SCRATCHPADS_PER_LESSON = 10
_RULE = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")


def is_scratchpad_block(block: str) -> bool:
    return block.strip().lower() == SCRATCHPAD_MARKER


def _ends_walkthrough(block: str) -> bool:
    first = block.lstrip("\n").split("\n", 1)[0]
    return bool(_HEADING.match(first)) or bool(_RULE.match(block)) or is_scratchpad_block(block)


def count_scratchpads(markdown: Optional[str]) -> int:
    return sum(1 for b in split_lesson_blocks(markdown or "") if is_scratchpad_block(b))


def check_scratchpads(markdown: str) -> None:
    """Raise ValueError when a [[scratchpad]] marker is misplaced.

    Each marker needs a problem statement in the block right before it and at
    least one walkthrough block after it.
    """
    blocks = split_lesson_blocks(markdown)
    markers = 0
    # True while we are inside a walkthrough: after a marker, before the next
    # heading or rule. A new problem there would be hidden in that walkthrough.
    in_walkthrough = False
    for i, block in enumerate(blocks):
        if is_scratchpad_block(block):
            markers += 1
            n = markers
            if in_walkthrough:
                raise ValueError(
                    f"[[scratchpad]] #{n}: separate it from the previous practice problem's walkthrough with a "
                    "horizontal rule (---) or a heading. Otherwise this problem is hidden inside that walkthrough."
                )
            in_walkthrough = True
            prev = blocks[i - 1] if i > 0 else ""
            has_problem = (
                prev
                and not is_scratchpad_block(prev)
                and not _RULE.match(prev)
                and any(line.strip() and not _HEADING.match(line) for line in prev.split("\n"))
            )
            if not has_problem:
                raise ValueError(
                    f"[[scratchpad]] #{n} must come right after the problem statement (the paragraph the "
                    "student solves), not after a heading, a rule or another marker."
                )
            nxt = blocks[i + 1] if i + 1 < len(blocks) else ""
            if not nxt or _ends_walkthrough(nxt):
                raise ValueError(
                    f"[[scratchpad]] #{n} needs a step-by-step walkthrough right after it, before the next "
                    "heading, horizontal rule or marker. The walkthrough stays hidden until the student "
                    "finishes or gives up."
                )
        elif SCRATCHPAD_MARKER in block.lower() and not block.lstrip().startswith("```"):
            raise ValueError(
                "[[scratchpad]] must sit on a line of its own with a blank line above and below it."
            )
        elif _ends_walkthrough(block):
            in_walkthrough = False
    if markers > MAX_SCRATCHPADS_PER_LESSON:
        raise ValueError(f"A lesson holds at most {MAX_SCRATCHPADS_PER_LESSON} [[scratchpad]] markers.")


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
