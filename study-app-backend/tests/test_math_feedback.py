"""Math grading feedback (GH #158, spec-grading-feedback-v2): short visible
feedback as sections, full solution in reasoning, caps enforced in code,
strongest provider first for shown work, one retry on a thin grade."""
from __future__ import annotations

from unittest.mock import AsyncMock

from src.schemas.attempt_schema import OcrResult
from src.services.llm_service import (
    _MAX_FULL_STEPS,
    _MAX_KEY_STEPS,
    LLMService,
    _is_thin_math_grade,
    _trim_sentences,
)

_STEPS = [
    {"description": "Integrate $x + y$ over the triangle", "expression": "\\int_0^1\\int_0^{1-x}(x+y)\\,dy\\,dx = \\frac{1}{3}"},
    {"description": "Set $c \\cdot \\frac{1}{3} = 1$", "expression": "c = 3"},
    {"description": "Check the density integrates to 1", "expression": "3 \\cdot \\frac{1}{3} = 1"},
]
_FIX = (
    "You wrote $\\int_0^{1-x} (x+y)\\,dy = x(1-x) + (1-x)^2$, dropping the $\\frac{1}{2}$ on the "
    "$y^2$ term, so the integral came out as $\\frac{1}{6}$ and $c = 6$."
)
_WRONG = {
    "is_correct": False,
    "note": "",
    "what_to_fix": _FIX,
    "key_steps": _STEPS[:2],
    "steps": _STEPS,
    "final_answer": "c = 3",
    "confidence": 0.9,
    "flagged_uncertain": False,
}
_THIN = {"is_correct": False, "what_to_fix": "", "steps": _STEPS, "final_answer": "c = 3", "confidence": 0.9}


def _svc(providers: list[str], replies: list[dict]) -> LLMService:
    svc = LLMService()
    svc._candidate_providers = AsyncMock(return_value=providers)  # type: ignore[method-assign]
    svc._complete_json_for_provider = AsyncMock(side_effect=replies)  # type: ignore[method-assign]
    return svc


async def test_wrong_answer_shows_fix_key_steps_and_answer_once() -> None:
    svc = _svc(["groq", "claude"], [_WRONG])
    grade = await svc.grade_math_answer("Find c.", "c = 3", "c = 6")
    assert grade.is_correct is False
    sections = grade.sections
    assert sections is not None
    assert sections.what_to_fix.startswith("You wrote") and sections.note == ""
    assert len(sections.key_steps) == 2 and len(sections.steps) == 3
    assert sections.final_answer == "$$c = 3$$"
    # Visible Markdown: fix, key steps, answer. The full solution is in reasoning.
    assert "**What to fix:**" in grade.feedback and "**Key steps**" in grade.feedback
    assert grade.feedback.count("c = 3$$") == 2  # key step 2 + the answer, not the full solution
    assert "How to solve it" not in grade.feedback and "Part (" not in grade.feedback
    assert grade.reasoning and "**Step 3:**" in grade.reasoning
    svc._complete_json_for_provider.assert_awaited_once()


async def test_right_answer_with_unfinished_value_keeps_note_and_flag() -> None:
    reply = {
        "is_correct": True,
        "note": "You reached $1 - \\Phi(2)$. Finish it: $1 - 0.9772 = 0.0228$.",
        "what_to_fix": "should be dropped on a right answer",
        "key_steps": _STEPS,
        "steps": _STEPS,
        "final_answer": "0.0228",
        "flagged_uncertain": True,
        "confidence": 0.8,
    }
    grade = await _svc(["groq"], [reply]).grade_math_answer("Find P.", "0.0228", "")
    assert grade.is_correct and grade.flagged_uncertain
    assert grade.sections and grade.sections.note.startswith("You reached")
    assert grade.sections.what_to_fix == "" and grade.sections.key_steps == []


async def test_caps_are_enforced_in_code() -> None:
    many = [{"description": f"Step {i}", "expression": "x"} for i in range(20)]
    long_fix = "This is wrong. " * 80
    grade = await _svc(["groq"], [{**_WRONG, "key_steps": many, "steps": many, "what_to_fix": long_fix}]).grade_math_answer(
        "Find c.", "c = 3", "c = 6"
    )
    assert grade.sections is not None
    assert len(grade.sections.key_steps) == _MAX_KEY_STEPS
    assert len(grade.sections.steps) == _MAX_FULL_STEPS
    assert len(grade.sections.what_to_fix) < 500 and grade.sections.what_to_fix.endswith(".")


async def test_thin_wrong_grade_retries_once_on_the_next_provider() -> None:
    svc = _svc(["groq", "minimax", "claude"], [_THIN, _WRONG])
    grade = await svc.grade_math_answer("Find c.", "c = 3", "c = 6")
    calls = svc._complete_json_for_provider.await_args_list
    assert [c.args[1] for c in calls] == ["groq", "minimax"]
    assert "dropping" in grade.feedback


async def test_a_longer_retry_does_not_win_when_it_is_also_thin() -> None:
    longer = {**_THIN, "steps": _STEPS * 3}
    svc = _svc(["groq", "minimax"], [_THIN, longer])
    grade = await svc.grade_math_answer("Find c.", "c = 3", "c = 6")
    assert grade.sections and len(grade.sections.steps) == 3
    assert svc._complete_json_for_provider.await_count == 2


async def test_blank_answer_is_not_retried() -> None:
    svc = _svc(["groq", "claude"], [_THIN])
    await svc.grade_math_answer("Find c.", "c = 3", "")
    svc._complete_json_for_provider.assert_awaited_once()


async def test_shown_work_goes_to_the_strongest_provider_first_and_skips_nvidia() -> None:
    svc = _svc(["nvidia", "groq", "minimax", "claude"], [_WRONG])
    work = OcrResult(transcript="$c = 6$", confidence=0.9, engine="claude")
    grade = await svc.grade_math_answer("Find c.", "c = 3", "", work=work)
    assert svc._complete_json_for_provider.await_args.args[1] == "claude"
    assert await svc._math_grading_candidates(shown_work=True) == ["claude", "minimax", "groq"]
    assert grade.reasoning and grade.reasoning.startswith("**What I read from your work:**")


async def test_old_reply_shape_still_reads() -> None:
    old = {
        "is_correct": False,
        "what_went_right": "Set up the triangle.",
        "what_went_wrong": _FIX,
        "steps": [{"part": "a", **_STEPS[0]}],
        "final_answers": [{"part": "a", "answer": "c = 3"}, {"part": "b", "answer": "f = 2x"}],
    }
    grade = await _svc(["groq"], [old]).grade_math_answer("Find c.", "c = 3", "c = 6")
    assert grade.sections and grade.sections.what_to_fix.startswith("You wrote")
    assert grade.sections.final_answer == "$c = 3$, $f = 2x$"


def test_thin_detection() -> None:
    assert _is_thin_math_grade(_THIN)
    assert not _is_thin_math_grade(_WRONG)
    assert not _is_thin_math_grade({**_THIN, "is_correct": True})
    assert _is_thin_math_grade({**_WRONG, "final_answer": ""})


def test_trim_never_cuts_inside_math() -> None:
    text = "First sentence. Then $a. b$ inside math. " + "x" * 50
    assert _trim_sentences(text, 30) == "First sentence."
