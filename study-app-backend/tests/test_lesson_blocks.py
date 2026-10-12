"""split_lesson_blocks must cut exactly where the frontend's splitLessonBlocks does.

The same cases and expected blocks live in
study-app-frontend/src/pages/LearningModuleLesson.test.tsx ("block split parity").
If one side changes, both tests must change together.
"""

import json

from src.services.llm_service import LLMService
from src.utils.lesson_blocks import normalize_tts_script, split_lesson_blocks, tts_entry_count

PARITY_CASES = [
    ("## Intro\n\nFirst para.\nStill first.\n\nSecond.", ["## Intro", "First para.\nStill first.", "Second."]),
    ("Text.\n\n```py\nx = 1\n\ny = 2\n```\n\nAfter.", ["Text.", "```py\nx = 1\n\ny = 2\n```", "After."]),
    ("Before.\n\n$$\na = b\n\nc = d\n$$\n\nAfter.", ["Before.", "$$\na = b\n\nc = d\n$$", "After."]),
    ("Open.\n\n$$\nx = 1\n## Next\n\nBody.", ["Open.", "$$\nx = 1", "## Next", "Body."]),
    ("\n\n- a\n- b\n\n\n\nEnd.\n", ["- a\n- b", "End."]),
]


def test_split_matches_frontend_cases():
    for markdown, expected in PARITY_CASES:
        assert split_lesson_blocks(markdown) == expected, markdown


def test_list_script_is_stored_as_json_array():
    stored = normalize_tts_script([" Intro. ", "", "Body."])
    assert json.loads(stored) == ["Intro.", "", "Body."]
    assert tts_entry_count(stored) == 3


def test_legacy_string_script_is_unchanged():
    assert normalize_tts_script("  Lesson. Body. ") == "Lesson. Body."
    assert tts_entry_count("Lesson. Body.") is None


def test_all_empty_list_counts_as_missing():
    assert normalize_tts_script(["", "  "]) == ""


def test_checked_script_keeps_miscounted_array():
    stored = LLMService._checked_tts_script(["a", "b"], 3)
    assert json.loads(stored) == ["a", "b"]
