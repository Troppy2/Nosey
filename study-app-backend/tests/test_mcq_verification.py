"""
Unit tests for MCQ truthfulness verification.

Step 1 covers only the correct_index hardening (LLMService._coerce_correct_index
and its use in _build_mcq_from_item / parse_practice_test). Later build steps
append the veto matcher, the decision table, and the repair round to this file
as they land, per the build order in
.claude/todos-features/mcq-verification-implementation-plan.md.
"""
from __future__ import annotations

from src.services.llm_service import GeneratedMCQ, LLMService


def _mcq_item(correct_index: object, option_count: int = 4) -> dict:
    options = [f"Option {i}" for i in range(option_count)]
    return {
        "question_text": "What is the answer?",
        "options": options,
        "correct_index": correct_index,
    }


class TestCoerceCorrectIndex:
    """LLMService._coerce_correct_index: reject, never clamp."""

    def test_rejects_out_of_range_high(self) -> None:
        assert LLMService._coerce_correct_index({"correct_index": 7}, 4) is None

    def test_rejects_negative(self) -> None:
        assert LLMService._coerce_correct_index({"correct_index": -1}, 4) is None

    def test_rejects_none(self) -> None:
        assert LLMService._coerce_correct_index({"correct_index": None}, 4) is None

    def test_rejects_missing_key(self) -> None:
        assert LLMService._coerce_correct_index({}, 4) is None

    def test_rejects_non_numeric_string(self) -> None:
        assert LLMService._coerce_correct_index({"correct_index": "banana"}, 4) is None

    def test_rejects_bool(self) -> None:
        # bool is a subclass of int in Python; True must not silently become index 1.
        assert LLMService._coerce_correct_index({"correct_index": True}, 4) is None

    def test_rejects_letter_out_of_option_range(self) -> None:
        # "B" (index 1) is out of range for a 1-option list only if option_count < 2.
        assert LLMService._coerce_correct_index({"correct_index": "B"}, 1) is None

    def test_accepts_letter_index(self) -> None:
        assert LLMService._coerce_correct_index({"correct_index": "B"}, 4) == 1

    def test_accepts_valid_int(self) -> None:
        assert LLMService._coerce_correct_index({"correct_index": 2}, 4) == 2

    def test_accepts_numeric_string(self) -> None:
        assert LLMService._coerce_correct_index({"correct_index": "3"}, 4) == 3


class TestBuildMcqFromItem:
    """_build_mcq_from_item must return None rather than a coerced wrong answer."""

    def test_out_of_range_index_is_rejected(self) -> None:
        llm = LLMService()
        result = llm._build_mcq_from_item(_mcq_item(7))
        assert result is None

    def test_negative_index_is_rejected(self) -> None:
        llm = LLMService()
        result = llm._build_mcq_from_item(_mcq_item(-1))
        assert result is None

    def test_missing_index_is_rejected(self) -> None:
        llm = LLMService()
        item = _mcq_item(0)
        del item["correct_index"]
        result = llm._build_mcq_from_item(item)
        assert result is None

    def test_non_numeric_index_is_rejected(self) -> None:
        llm = LLMService()
        result = llm._build_mcq_from_item(_mcq_item("banana"))
        assert result is None

    def test_bool_index_is_rejected(self) -> None:
        llm = LLMService()
        result = llm._build_mcq_from_item(_mcq_item(True))
        assert result is None

    def test_three_options_padded_then_valid_index_kept(self) -> None:
        llm = LLMService()
        item = {
            "question_text": "What is the answer?",
            "options": ["A", "B", "C"],
            "correct_index": 1,
        }
        result = llm._build_mcq_from_item(item)
        assert result is not None
        assert isinstance(result, GeneratedMCQ)
        assert len(result.options) == 4
        assert result.options[-1] == "None of the above"
        assert result.correct_index == 1

    def test_letter_index_with_four_options_resolves(self) -> None:
        llm = LLMService()
        result = llm._build_mcq_from_item(_mcq_item("B"))
        assert result is not None
        assert result.correct_index == 1

    def test_valid_index_kept(self) -> None:
        llm = LLMService()
        result = llm._build_mcq_from_item(_mcq_item(2))
        assert result is not None
        assert result.correct_index == 2


class TestNormalizeMcqItemAliasText:
    """_normalize_mcq_item: an aliased answer key holding option TEXT (not an
    index) must resolve to that option's index on an exact match only."""

    def test_correct_answer_alias_with_matching_option_text(self) -> None:
        llm = LLMService()
        item = {
            "question_text": "What is the answer?",
            "options": ["Alpha", "Beta", "Gamma", "Delta"],
            "correct_answer": "Gamma",
        }
        normalized = llm._normalize_mcq_item(item)
        assert normalized["correct_index"] == 2  # type: ignore[index]

    def test_correct_answer_alias_with_no_matching_option_is_left_alone(self) -> None:
        llm = LLMService()
        item = {
            "question_text": "What is the answer?",
            "options": ["Alpha", "Beta", "Gamma", "Delta"],
            "correct_answer": "Not an option",
        }
        normalized = llm._normalize_mcq_item(item)
        # No exact match: the alias value is copied through unchanged (still a
        # string), and _build_mcq_from_item will reject it downstream rather
        # than fuzzily guessing here.
        assert normalized["correct_index"] == "Not an option"  # type: ignore[index]

    def test_build_mcq_from_item_resolves_full_alias_pipeline(self) -> None:
        llm = LLMService()
        item = {
            "question_text": "What is the answer?",
            "options": ["Alpha", "Beta", "Gamma", "Delta"],
            "correct_answer": "Gamma",
        }
        result = llm._build_mcq_from_item(item)
        assert result is not None
        assert result.correct_index == 2
