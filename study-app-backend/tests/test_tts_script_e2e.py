"""
End-to-end TTS-script tests against the real Ollama provider (no mocks).

Purpose: guard the narration-script contract. The tts_script returned by
generate_module_content / regenerate_module_support must be speakable prose:
no LaTeX, no markdown fences, and no raw notation like 'O(n)' that speech
engines skip or mangle (the prompt requires 'O of n' style wording).

These tests make real LLM calls, so they are skipped automatically when
Ollama is not configured. Run them explicitly with:

    pytest tests/test_tts_script_e2e.py -v -s

They are intentionally NOT part of a mocked suite: the thing under test is
model compliance with the prompt, which mocks cannot exercise.
"""
from __future__ import annotations

import re

import pytest

from src.config import settings
from src.services.llm_service import LLMService

pytestmark = pytest.mark.skipif(
    not (settings.ollama_api_key or settings.ollama_base_url),
    reason="Ollama is not configured; e2e TTS tests need a real provider.",
)

# Notes dense with the notation the user reported the TTS mangling: Big-O,
# LaTeX-style math, subscripts, and code identifiers.
NOTATION_HEAVY_NOTES = """
Binary search runs in O(log n) time because each comparison halves the search
space. Linear search is O(n); for an array of size n it may inspect every
element. Appending to a dynamic array is O(1) amortized, but a resize copies
all n elements, which costs O(n).

The quadratic formula solves $ax^2 + bx + c = 0$ with
$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$. A sequence a_i converges when for
every epsilon > 0 there exists N such that |a_i - L| <= epsilon for all i >= N.

```python
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```
"""

# Notation that must never appear verbatim in a spoken script. Each entry is
# (human label, compiled pattern). Kept liberal on purpose: a single stray
# 'O(n)' in a 1000-word script is exactly the bug being guarded against.
FORBIDDEN_IN_SPEECH = [
    ("LaTeX delimiter $", re.compile(r"\$")),
    ("code fence ```", re.compile(r"```")),
    ("markdown heading #", re.compile(r"^#{1,6}\s", re.MULTILINE)),
    ("LaTeX command backslash", re.compile(r"\\[a-zA-Z]+")),
    ("raw Big-O notation like O(n)", re.compile(r"\bO\([^)]*\)")),
    ("caret exponent like n^2", re.compile(r"\w\^\{?\w")),
    ("bracket indexing like arr[i]", re.compile(r"\w\[\w+\]")),
]


def _assert_speakable(script: str, source: str) -> None:
    assert script, f"{source}: tts_script came back empty"
    # A narration of these notes should be substantial prose, not a stub.
    assert len(script.split()) > 80, (
        f"{source}: tts_script suspiciously short ({len(script.split())} words):\n{script[:400]}"
    )
    offenders = []
    for label, pattern in FORBIDDEN_IN_SPEECH:
        hit = pattern.search(script)
        if hit:
            start = max(0, hit.start() - 60)
            offenders.append(f"{label}: ...{script[start:hit.end() + 60]}...")
    assert not offenders, (
        f"{source}: tts_script contains notation a voice cannot read:\n" + "\n".join(offenders)
    )
    # Positive signal: complexity discussed in spoken form somewhere.
    spoken_big_o = re.search(r"\bO of\b|\bbig O\b|constant time|logarithmic|linear time", script, re.IGNORECASE)
    assert spoken_big_o, (
        f"{source}: notes are about Big-O but the script never says it in words:\n{script[:400]}"
    )


@pytest.mark.asyncio
async def test_generate_module_content_tts_is_speakable():
    """Full bundled generation on notation-heavy notes: script must be spoken prose."""
    result = await LLMService().generate_module_content(
        NOTATION_HEAVY_NOTES,
        "Algorithm Complexity and Binary Search",
        "Big-O costs of search and dynamic arrays, plus the quadratic formula.",
        quiz_count=3,
        provider="ollama",
    )
    assert result["lesson"], "lesson came back empty"
    assert len(result["quiz"]) >= 1, "quiz came back empty"
    _assert_speakable(str(result["tts_script"]), "generate_module_content")


@pytest.mark.asyncio
async def test_regenerate_module_support_tts_is_speakable():
    """Edit-regen path: script rebuilt from a notation-heavy lesson must be spoken prose."""
    lesson = (
        "## Complexity of Search\n\n"
        "Binary search runs in $O(\\log n)$ because each step halves the range, "
        "while linear search is $O(n)$. For an array `arr`, checking `arr[mid]` "
        "is $O(1)$.\n\n"
        "## The Quadratic Formula\n\n"
        "Solutions of $ax^2 + bx + c = 0$ are given by "
        "$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$."
    )
    result = await LLMService().regenerate_module_support(
        lesson,
        "Complexity of Search",
        quiz_count=3,
        provider="ollama",
    )
    assert len(result["quiz"]) >= 1, "quiz came back empty"
    _assert_speakable(str(result["tts_script"]), "regenerate_module_support")
