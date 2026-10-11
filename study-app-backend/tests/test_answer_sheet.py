"""Answer sheet for a recreated practice test, and image uploads.

Covers:
- LLMService.apply_answer_sheet(): matched questions take the sheet's answer
  and solution, unmatched or invalid entries leave the question untouched, a
  failed call changes nothing, already-matched questions are skipped
- parse_practice_test(): the sheet is matched before keyless questions are solved
- _reviewed_questions_from_form(): sheet fields survive the review round trip
- explain_objective_answer(): an answer-sheet key is never overruled
- practice_vision._image_jpeg_b64(): big images are scaled down to JPEG
"""
from __future__ import annotations

import asyncio
import base64
import json
from unittest.mock import AsyncMock, patch

import pytest

from src.routes.tests import _reviewed_questions_from_form
from src.services.llm_service import GeneratedFRQ, GeneratedMCQ, LLMService


def _mcq(text: str = "2 + 2 = ?", inferred: bool = True) -> GeneratedMCQ:
    return GeneratedMCQ(text, ["3", "4", "5"], 0, answer_inferred=inferred, group_label="1")


def _frq(text: str = "Differentiate x^2.", inferred: bool = True) -> GeneratedFRQ:
    return GeneratedFRQ(text, "guess", answer_inferred=inferred, group_label="2")


def test_matched_questions_take_the_sheet_answer_and_solution():
    llm = LLMService()
    reply = {"answers": [
        {"q": 1, "found": True, "option": "B", "solution": "Count: 2 + 2 = 4"},
        {"q": 2, "found": True, "answer": "2x", "solution": "1 mark: power rule"},
    ]}
    with patch.object(llm, "_complete_json_strongest", AsyncMock(return_value=reply)):
        mcq, frq = asyncio.run(llm.apply_answer_sheet([_mcq()], [_frq()], "1. B\n2. 2x (1 mark: power rule)"))
    assert mcq[0].correct_index == 1
    assert mcq[0].answer_from_sheet and not mcq[0].answer_inferred
    assert mcq[0].solution == "Count: 2 + 2 = 4"
    assert frq[0].expected_answer == "2x"
    assert frq[0].answer_from_sheet and not frq[0].answer_inferred
    assert "power rule" in frq[0].solution


def test_unmatched_and_invalid_entries_leave_questions_alone():
    llm = LLMService()
    reply = {"answers": [
        {"q": 1, "found": True, "option": "Z"},  # not an option
        {"q": 2, "found": False, "answer": "made up"},
    ]}
    original_mcq, original_frq = _mcq(), _frq()
    with patch.object(llm, "_complete_json_strongest", AsyncMock(return_value=reply)):
        mcq, frq = asyncio.run(llm.apply_answer_sheet([original_mcq], [original_frq], "sheet"))
    assert mcq == [original_mcq]
    assert frq == [original_frq]


def test_failed_call_changes_nothing():
    llm = LLMService()
    with patch.object(llm, "_complete_json_strongest", AsyncMock(side_effect=RuntimeError("down"))):
        mcq, frq = asyncio.run(llm.apply_answer_sheet([_mcq()], [_frq()], "sheet"))
    assert not mcq[0].answer_from_sheet and mcq[0].answer_inferred
    assert frq[0].expected_answer == "guess"


def test_empty_sheet_and_already_matched_make_no_call():
    llm = LLMService()
    done = GeneratedFRQ("q", "a", answer_from_sheet=True, solution="s")
    call = AsyncMock()
    with patch.object(llm, "_complete_json_strongest", call):
        asyncio.run(llm.apply_answer_sheet([_mcq()], [], ""))
        asyncio.run(llm.apply_answer_sheet([], [done], "sheet"))
    call.assert_not_called()


def test_parse_practice_test_matches_the_sheet_before_solving():
    llm = LLMService()
    parsed = {"mcq": [{"question_text": "2 + 2 = ?", "options": ["3", "4"], "correct_index": 0,
                       "answer_from_document": False}], "frq": []}
    order: list[str] = []

    async def fake_sheet(mcq, frq, sheet):
        order.append("sheet")
        return [m.__class__(**{**m.__dict__, "correct_index": 1, "answer_inferred": False,
                               "answer_from_sheet": True}) for m in mcq], frq

    async def fake_solve(mcq, frq, context=""):
        order.append("solve")
        assert all(not q.answer_inferred for q in mcq), "a sheet-matched question must not be re-solved"
        return mcq, frq

    with patch.object(llm, "_complete_json", AsyncMock(return_value=parsed)), \
            patch.object(llm, "apply_answer_sheet", side_effect=fake_sheet), \
            patch.object(llm, "_solve_keyless_questions", side_effect=fake_solve):
        mcq, _ = asyncio.run(llm.parse_practice_test("1. 2 + 2 = ?\nA. 3\nB. 4", answer_sheet="1. B"))
    assert order == ["sheet", "solve"]
    assert mcq[0].correct_index == 1 and mcq[0].answer_from_sheet


def test_review_form_keeps_sheet_fields():
    raw = json.dumps([
        {"kind": "mcq", "question_text": "Q1", "options": ["a", "b"], "correct_index": 1,
         "answer_inferred": True, "answer_from_sheet": True, "solution": "because b"},
        {"kind": "frq", "question_text": "Q2", "expected_answer": "", "answer_from_sheet": True},
    ])
    mcq, frq = _reviewed_questions_from_form(raw)
    assert mcq[0].answer_from_sheet and not mcq[0].answer_inferred and mcq[0].solution == "because b"
    # No answer at all: not backed by the sheet, whatever the client said.
    assert not frq[0].answer_from_sheet and frq[0].answer_inferred


def test_answer_sheet_key_is_never_overruled():
    llm = LLMService()
    reply = {"feedback": "B is right.", "answer_key_ok": False, "actual_correct_answer": "a"}
    call = AsyncMock(return_value=reply)
    with patch.object(llm, "_complete_json", call):
        result = asyncio.run(llm.explain_objective_answer(
            "Q", "b", "a", False, options=["a", "b"], sheet_solution="1 mark for b",
        ))
    assert result.answer_key_ok
    prompt = call.call_args.args[0]
    assert "official answer sheet" in prompt and "1 mark for b" in prompt
    assert "may occasionally be wrong" not in prompt


def test_big_image_is_scaled_to_jpeg(tmp_path):
    fitz = pytest.importorskip("fitz")
    from src.services.practice_vision import _IMAGE_MAX_EDGE, _image_jpeg_b64

    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 4100, 3000), True)  # with alpha
    pixmap.clear_with(200)
    path = tmp_path / "photo.png"
    pixmap.save(str(path))
    data = base64.b64decode(_image_jpeg_b64(str(path)))
    assert data[:2] == b"\xff\xd8"  # JPEG
    out = fitz.Pixmap(data)
    assert max(out.width, out.height) <= _IMAGE_MAX_EDGE


def test_unreadable_image_raises_a_clear_error(tmp_path):
    pytest.importorskip("fitz")
    from src.services.practice_vision import _image_jpeg_b64

    path = tmp_path / "broken.jpg"
    path.write_bytes(b"not an image")
    with pytest.raises(ValueError, match="could not be opened"):
        _image_jpeg_b64(str(path))
