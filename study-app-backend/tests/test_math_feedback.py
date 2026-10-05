"""Math grading depth (GH #158): visible walkthrough, per-part answers,
strongest provider first for shown work, one retry on a thin grade."""
from __future__ import annotations

from unittest.mock import AsyncMock

from src.schemas.attempt_schema import OcrResult
from src.services.llm_service import LLMService, _is_thin_math_grade

_STEPS = [
    {"part": "a", "step": 1, "description": "Integrate $x + y$ over the triangle", "expression": "\\int_0^1\\int_0^{1-x}(x+y)\\,dy\\,dx = \\frac{1}{3}"},
    {"part": "a", "step": 2, "description": "Set $c \\cdot \\frac{1}{3} = 1$", "expression": "c = 3"},
    {"part": "b", "step": 3, "description": "Integrate out $y$", "expression": "f_X(x) = \\frac{3(1-x^2)}{2}"},
]
_WHAT_WRONG = (
    "You wrote $\\int_0^{1-x} (x+y)\\,dy = x(1-x) + (1-x)^2$, dropping the $\\frac{1}{2}$ on the "
    "$y^2$ term, so the total integral came out as $\\frac{1}{6}$ and $c = 6$. It should be $\\frac{1}{3}$."
)
_DEEP = {
    "is_correct": False,
    "what_went_right": "Set up the triangle $x + y < 1$ correctly.",
    "what_went_wrong": _WHAT_WRONG,
    "steps": _STEPS,
    "final_answers": [{"part": "a", "answer": "c = 3"}, {"part": "b", "answer": "f_X(x) = \\frac{3(1-x^2)}{2}"}],
    "confidence": 0.9,
    "flagged_uncertain": False,
}
_THIN = {
    "is_correct": False,
    "what_went_right": "",
    "what_went_wrong": "Computed c incorrectly.",
    "steps": [{"step": 1, "description": "c = 3", "expression": "c = 3"}],
    "final_answer": "c = 3",
    "confidence": 0.9,
}


def _svc(providers: list[str], replies: list[dict]) -> LLMService:
    svc = LLMService()
    svc._candidate_providers = AsyncMock(return_value=providers)  # type: ignore[method-assign]
    svc._complete_json_for_provider = AsyncMock(side_effect=replies)  # type: ignore[method-assign]
    return svc


async def test_wrong_answer_shows_walkthrough_and_per_part_answers() -> None:
    svc = _svc(["groq", "claude"], [_DEEP])
    grade = await svc.grade_math_answer("Find c, then f_X.", "c = 3", "c = 6")
    assert grade.is_correct is False
    assert "**How to solve it**" in grade.feedback
    assert "*Part (a)*" in grade.feedback and "*Part (b)*" in grade.feedback
    assert "**Final answers:**" in grade.feedback and "**(b)**" in grade.feedback
    assert grade.reasoning is None  # the walkthrough is not duplicated in the dropdown
    svc._complete_json_for_provider.assert_awaited_once()


async def test_correct_answer_keeps_steps_in_reasoning() -> None:
    svc = _svc(["groq"], [{**_DEEP, "is_correct": True, "what_went_wrong": ""}])
    grade = await svc.grade_math_answer("Find c.", "c = 3", "c = 3")
    assert "How to solve it" not in grade.feedback
    assert grade.reasoning and "**Step 1:**" in grade.reasoning


async def test_thin_wrong_grade_retries_once_on_the_next_provider() -> None:
    svc = _svc(["groq", "minimax", "claude"], [_THIN, _DEEP])
    grade = await svc.grade_math_answer("Find c.", "c = 3", "c = 6")
    calls = svc._complete_json_for_provider.await_args_list
    assert [c.args[1] for c in calls] == ["groq", "minimax"]
    assert "How to solve it" in grade.feedback and "dropping" in grade.feedback


async def test_thin_retry_that_is_no_better_keeps_the_first_grade() -> None:
    svc = _svc(["groq", "minimax"], [_THIN, {**_THIN, "what_went_wrong": "Wrong."}])
    grade = await svc.grade_math_answer("Find c.", "c = 3", "c = 6")
    assert "Computed c incorrectly." in grade.feedback
    assert svc._complete_json_for_provider.await_count == 2


async def test_blank_answer_is_not_retried() -> None:
    svc = _svc(["groq", "claude"], [_THIN])
    await svc.grade_math_answer("Find c.", "c = 3", "")
    svc._complete_json_for_provider.assert_awaited_once()


async def test_shown_work_goes_to_the_strongest_provider_first_and_skips_ollama() -> None:
    svc = _svc(["ollama", "groq", "minimax", "claude"], [_DEEP])
    work = OcrResult(transcript="$c = 6$", confidence=0.9, engine="claude")
    await svc.grade_math_answer("Find c.", "c = 3", "", work=work)
    assert svc._complete_json_for_provider.await_args.args[1] == "claude"
    assert await svc._math_grading_candidates(shown_work=True) == ["claude", "minimax", "groq"]


async def test_old_single_final_answer_key_still_renders() -> None:
    svc = _svc(["groq"], [{**_DEEP, "final_answers": None, "final_answer": "c = 3"}])
    grade = await svc.grade_math_answer("Find c.", "c = 3", "c = 6")
    assert "**Final answer:** $$c = 3$$" in grade.feedback


def test_thin_detection() -> None:
    assert _is_thin_math_grade(_THIN)
    assert not _is_thin_math_grade(_DEEP)
    assert not _is_thin_math_grade({**_THIN, "is_correct": True})
