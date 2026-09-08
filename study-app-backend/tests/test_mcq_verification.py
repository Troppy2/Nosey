"""
Unit tests for MCQ truthfulness verification.

Step 1 covers the correct_index hardening (LLMService._coerce_correct_index
and its use in _build_mcq_from_item / parse_practice_test).
Step 2 covers the two verification calls (derive_mcq_answers,
adjudicate_mcq_matches), mocked at _complete_json so no provider is needed.
Later build steps append the veto matcher, the decision table, and the repair
round to this file as they land, per the build order in
.claude/todos-features/mcq-verification-implementation-plan.md.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

from src.services.llm_service import DerivedAnswer, GeneratedMCQ, LLMService


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


# ── Step 2: derive_mcq_answers ───────────────────────────────────────────────
# asyncio_mode = auto (pytest.ini) runs async defs without an explicit marker.


class TestDeriveMcqAnswers:

    async def test_empty_questions_returns_empty_without_calling_provider(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock()  # type: ignore[method-assign]
        result = await llm.derive_mcq_answers([], "some notes")
        assert result == []
        llm._complete_json.assert_not_called()

    async def test_single_batch_happy_path(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={
            "answers": [
                {"index": 0, "answer": "Paris", "derivable": True, "confidence": 0.9},
                {"index": 1, "answer": "42", "derivable": True, "confidence": 0.8},
            ]
        })
        result = await llm.derive_mcq_answers(
            ["What is the capital of France?", "What is 6 times 7?"], "notes"
        )
        assert len(result) == 2
        by_index = {d.index: d for d in result}
        assert by_index[0].answer == "Paris"
        assert by_index[0].derivable is True
        assert by_index[0].confidence == 0.9
        assert by_index[1].answer == "42"
        llm._complete_json.assert_awaited_once()

    async def test_malformed_json_returns_empty(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={"wrong_key": "oops"})
        result = await llm.derive_mcq_answers(["Q1?"], "notes")
        assert result == []

    async def test_provider_exception_returns_empty(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(side_effect=Exception("provider down"))
        result = await llm.derive_mcq_answers(["Q1?"], "notes")
        assert result == []

    async def test_out_of_range_index_is_discarded(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={
            "answers": [
                {"index": 0, "answer": "ok", "derivable": True, "confidence": 0.5},
                {"index": 99, "answer": "bad", "derivable": True, "confidence": 0.5},
            ]
        })
        result = await llm.derive_mcq_answers(["Only one question?"], "notes")
        assert len(result) == 1
        assert result[0].index == 0

    async def test_duplicate_index_keeps_first(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={
            "answers": [
                {"index": 0, "answer": "first", "derivable": True, "confidence": 0.9},
                {"index": 0, "answer": "second", "derivable": True, "confidence": 0.1},
            ]
        })
        result = await llm.derive_mcq_answers(["Q1?"], "notes")
        assert len(result) == 1
        assert result[0].answer == "first"

    async def test_confidence_is_clamped(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={
            "answers": [{"index": 0, "answer": "x", "derivable": True, "confidence": 5.0}]
        })
        result = await llm.derive_mcq_answers(["Q1?"], "notes")
        assert result[0].confidence == 1.0

    async def test_derivable_defaults_true_when_missing(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={
            "answers": [{"index": 0, "answer": "x", "confidence": 0.5}]
        })
        result = await llm.derive_mcq_answers(["Q1?"], "notes")
        assert result[0].derivable is True

    async def test_sharding_splits_batch_and_offsets_indices(self) -> None:
        """A batch larger than _VERIFY_BATCH_MAX (12) is split into shards, each
        called separately, with the second shard's local index 0 offset to the
        batch's global index."""
        llm = LLMService()
        questions = [f"Question {i}?" for i in range(14)]  # forces 2 shards: 12 + 2

        call_count = 0

        async def fake_complete_json(prompt: str, provider=None):
            nonlocal call_count
            call_count += 1
            # Each shard answers every question it was sent with local index 0..n-1.
            if call_count == 1:
                answers = [{"index": i, "answer": f"a{i}", "derivable": True, "confidence": 0.9} for i in range(12)]
            else:
                answers = [{"index": i, "answer": f"b{i}", "derivable": True, "confidence": 0.9} for i in range(2)]
            return {"answers": answers}

        llm._complete_json = fake_complete_json  # type: ignore[method-assign]
        result = await llm.derive_mcq_answers(questions, "notes")
        assert call_count == 2
        assert len(result) == 14
        by_index = {d.index: d for d in result}
        assert by_index[0].answer == "a0"
        assert by_index[11].answer == "a11"
        # Second shard's local index 0 must be offset to global index 12.
        assert by_index[12].answer == "b0"
        assert by_index[13].answer == "b1"

    async def test_one_failing_shard_does_not_lose_the_other(self) -> None:
        llm = LLMService()
        questions = [f"Question {i}?" for i in range(14)]

        call_count = 0

        async def fake_complete_json(prompt: str, provider=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("provider down for shard 1")
            answers = [{"index": i, "answer": f"b{i}", "derivable": True, "confidence": 0.9} for i in range(2)]
            return {"answers": answers}

        llm._complete_json = fake_complete_json  # type: ignore[method-assign]
        result = await llm.derive_mcq_answers(questions, "notes")
        assert len(result) == 2  # only the surviving shard's answers


# ── Step 2: adjudicate_mcq_matches ───────────────────────────────────────────

def _adjudicate_item(index: int, options: list[str]) -> dict:
    return {"index": index, "question": "Q?", "answer": "42", "options": options}


class TestAdjudicateMcqMatches:

    async def test_empty_items_returns_empty_without_calling_provider(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock()  # type: ignore[method-assign]
        result = await llm.adjudicate_mcq_matches([])
        assert result == {}
        llm._complete_json.assert_not_called()

    async def test_happy_path_match(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={"matches": [{"index": 0, "matched_option": 2}]})
        result = await llm.adjudicate_mcq_matches([_adjudicate_item(0, ["a", "b", "c", "d"])])
        assert result == {0: 2}

    async def test_no_match_returns_negative_one(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={"matches": [{"index": 0, "matched_option": -1}]})
        result = await llm.adjudicate_mcq_matches([_adjudicate_item(0, ["a", "b", "c", "d"])])
        assert result == {0: -1}

    async def test_matched_option_out_of_range_is_dropped(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={"matches": [{"index": 0, "matched_option": 99}]})
        result = await llm.adjudicate_mcq_matches([_adjudicate_item(0, ["a", "b", "c", "d"])])
        assert result == {}

    async def test_unknown_index_is_dropped(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={"matches": [{"index": 5, "matched_option": 0}]})
        result = await llm.adjudicate_mcq_matches([_adjudicate_item(0, ["a", "b", "c", "d"])])
        assert result == {}

    async def test_malformed_json_returns_empty(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={"oops": True})
        result = await llm.adjudicate_mcq_matches([_adjudicate_item(0, ["a", "b"])])
        assert result == {}

    async def test_provider_exception_returns_empty(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(side_effect=Exception("provider down"))
        result = await llm.adjudicate_mcq_matches([_adjudicate_item(0, ["a", "b"])])
        assert result == {}

    async def test_sharding_merges_results_across_shards(self) -> None:
        llm = LLMService()
        items = [_adjudicate_item(i, ["a", "b", "c", "d"]) for i in range(14)]

        call_count = 0

        async def fake_complete_json(prompt: str, provider=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"matches": [{"index": i, "matched_option": 0} for i in range(12)]}
            return {"matches": [{"index": i, "matched_option": 1} for i in range(12, 14)]}

        llm._complete_json = fake_complete_json  # type: ignore[method-assign]
        result = await llm.adjudicate_mcq_matches(items)
        assert call_count == 2
        assert len(result) == 14
        assert result[0] == 0
        assert result[13] == 1
