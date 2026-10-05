"""A drawn answer shows the student's working, not the whole pad (GH #157)."""
from __future__ import annotations

from src.schemas.attempt_schema import OcrResult
from src.services.grading_service import _context_answer, _drawn_answer
from src.services.ocr_service import _parse_transcription, answer_work_lines, is_read_from_drawing

_RAW = """TRANSCRIPT:
I Ran out of room + give up I am lost
Q3]
a]
What I Know 1] $x > 0$ and $y > 0$ 2] $x + y < 1$
This means $x = 0$ and $y = 1$ So $(0, 1)$
---
LAYOUT: NONE
---
LEGIBILITY: high
---
NOT WORK: 1, 2, 3"""


def test_reader_drops_headings_and_remarks_from_the_shown_answer() -> None:
    result = _parse_transcription(_RAW, "claude")
    assert result.transcript.startswith("I Ran out of room")
    assert result.answer_work == (
        "What I Know 1] $x > 0$ and $y > 0$ 2] $x + y < 1$\n\nThis means $x = 0$ and $y = 1$ So $(0, 1)$"
    )
    assert is_read_from_drawing(result.answer_work, result.transcript)
    assert result.confidence == 0.9


def test_nothing_dropped_or_everything_dropped_means_no_trim() -> None:
    assert answer_work_lines("a\nb", "NONE") is None
    assert answer_work_lines("a\nb", "") is None
    assert answer_work_lines("a\nb", "1, 2") is None
    assert answer_work_lines("a\nb", "7") is None  # out of range drops nothing


def test_an_older_three_section_reply_still_parses() -> None:
    result = _parse_transcription("TRANSCRIPT: $x = 4$\n---\nLAYOUT: NONE\n---\nLEGIBILITY: medium", "gemini")
    assert result.transcript == "$x = 4$" and result.answer_work is None and result.confidence == 0.6


def test_stored_answer_is_the_working_and_typed_text_stays_typed() -> None:
    work = OcrResult(transcript="Q3]\n\n$c = 3$", confidence=0.9, engine="claude", answer_work="$c = 3$")
    assert _drawn_answer(work) == "$c = 3$"
    assert _drawn_answer(OcrResult(transcript="$c = 3$", confidence=0.9, engine="claude")) == "$c = 3$"
    assert _drawn_answer(None) == ""
    assert not is_read_from_drawing("c = 3", work.transcript)
    # A stored drawn answer is context as the full read, not as typed text.
    assert _context_answer("$c = 3$", work.transcript) == work.transcript
