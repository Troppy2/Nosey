"""Practice scratch pad progress on article lesson modules.

A lesson's [[scratchpad]] markers (see utils/lesson_blocks.py) are practice
problems. Each one is "open" until the student either finishes it (ink on the
pad, then Done) or gives up; both are final and both unlock the module quiz.
Pure functions over the module row: no LLM, no shared state.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from src.models.learning_module import LearningModule
from src.utils.lesson_blocks import count_scratchpads

OPEN = "open"
DONE = "done"
GAVE_UP = "gave_up"
RESOLVED = (DONE, GAVE_UP)

# Same bar as MIN_INK_BBOX_AREA in study-app-frontend/src/components/ScratchPad.tsx:
# ink whose bounding box is smaller than this is a stray tap, not work.
MIN_INK_BBOX_AREA = 400


def practice_progress(module: LearningModule) -> list[dict[str, Any]]:
    """One entry per marker in the lesson, padded/trimmed from what is stored."""
    total = count_scratchpads(module.lesson_content)
    try:
        raw = json.loads(module.practice_progress or "[]")
    except ValueError:
        raw = []
    out: list[dict[str, Any]] = []
    for i in range(total):
        item = raw[i] if isinstance(raw, list) and i < len(raw) and isinstance(raw[i], dict) else {}
        status = item.get("status")
        strokes = item.get("strokes")
        out.append(
            {
                "status": status if status in RESOLVED else OPEN,
                "strokes": strokes if isinstance(strokes, str) else None,
            }
        )
    return out


def unresolved(progress: list[dict[str, Any]]) -> int:
    return sum(1 for p in progress if p["status"] not in RESOLVED)


def summary(progress: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(progress),
        "done": sum(1 for p in progress if p["status"] == DONE),
        "gave_up": sum(1 for p in progress if p["status"] == GAVE_UP),
    }


def has_ink(strokes_json: Optional[str]) -> bool:
    """Server-side twin of isScratchPadEmpty: real (non-highlighter) ink, big enough."""
    if not strokes_json:
        return False
    try:
        data = json.loads(strokes_json)
    except ValueError:
        return False
    strokes = data.get("strokes") if isinstance(data, dict) else None
    if not isinstance(strokes, list):
        return False
    xs: list[float] = []
    ys: list[float] = []
    for stroke in strokes:
        if not isinstance(stroke, dict) or stroke.get("h"):
            continue
        points = stroke.get("points")
        if not isinstance(points, list):
            continue
        for i in range(0, len(points) - 1, 2):
            x, y = points[i], points[i + 1]
            if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                xs.append(float(x))
                ys.append(float(y))
    if not xs:
        return False
    return (max(xs) - min(xs)) * (max(ys) - min(ys)) >= MIN_INK_BBOX_AREA
