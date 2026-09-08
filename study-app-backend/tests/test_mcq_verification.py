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

import asyncio
from dataclasses import replace
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


# ── Step 3: the drop-veto matcher ─────────────────────────────────────────────

from src.services.mcq_verification_service import (  # noqa: E402
    MCQVerificationService,
    VerifiableMCQ,
    answers_match,
    veto_drop,
)


class TestMatcherLadder:
    """These assert the VETO outcome (or its absence), never a drop — the
    matcher can only ever save a question, per the module's one-way-valve
    design."""

    def test_three_way_match_yields_no_veto(self) -> None:
        # "4" matches three of the four options: the matcher cannot say which
        # one was meant, so it must stay silent rather than guess.
        assert veto_drop("4", ["4", "8", "x = 4", "four"]) is None

    def test_assignment_prefix_matches_bare_value(self) -> None:
        assert answers_match("x = 4", "4") is True
        assert answers_match("4", "$x = 4$") is True

    def test_fraction_matches_decimal_and_latex_frac(self) -> None:
        assert answers_match(r"\frac{1}{2}", "0.5") is True
        assert answers_match("1/2", "0.5") is True

    def test_number_word_matches_digit(self) -> None:
        assert answers_match("four", "4") is True

    def test_cdot_matches_plain_asterisk_multiplication(self) -> None:
        # Regression: normalize_answer_text's generic markdown strip used to
        # remove a literal "*" (it also means markdown bold) BEFORE the math
        # normalizer could convert \cdot into the same symbol, so "3*x" was
        # silently mangled into "3x" and this never matched.
        assert answers_match(r"3 \cdot x^{2}", "3*x^2", variant="math") is True
        assert answers_match(r"2 \cdot 5", "2*5", variant="math") is True

    def test_braced_power_matches_plain_caret_with_spacing(self) -> None:
        assert answers_match(r"x^{2} + 1", "x^2+1", variant="math") is True

    def test_prose_variant_still_strips_asterisk_as_markdown_bold(self) -> None:
        # The math-only exemption must not leak into the default variant:
        # "*emphasis*" is markdown, not multiplication, outside math mode.
        assert answers_match("*Paris*", "Paris") is True

    def test_mitosis_does_not_match_meiosis(self) -> None:
        # Classic Dice-coefficient false positive risk: a false veto here would
        # keep a genuinely wrong question, so this must stay unmatched.
        assert answers_match("mitosis", "meiosis") is False

    def test_short_word_does_not_match_longer_phrase_containing_it(self) -> None:
        assert answers_match("cell", "cell membrane potential") is False

    def test_coding_variant_is_case_sensitive(self) -> None:
        assert answers_match("HelloWorld", "helloworld", variant="coding") is False
        assert answers_match("HelloWorld", "HelloWorld", variant="coding") is True

    def test_single_clear_match_yields_veto_at_that_index(self) -> None:
        assert veto_drop("Paris", ["London", "Paris", "Berlin", "Madrid"]) == 1

    def test_no_match_at_all_yields_no_veto(self) -> None:
        assert veto_drop("Tokyo", ["London", "Paris", "Berlin", "Madrid"]) is None


# ── Step 5: the decision table ────────────────────────────────────────────────

def _verifiable(key, options=None, correct_index=0) -> VerifiableMCQ:
    return VerifiableMCQ(
        key=key,
        question_text="What is the answer?",
        options=options or ["A", "B", "C", "D"],
        correct_index=correct_index,
    )


def _derived(index: int, answer: str, confidence: float, derivable: bool = True) -> DerivedAnswer:
    return DerivedAnswer(index=index, answer=answer, derivable=derivable, confidence=confidence)


class TestDecisionTableUnit:
    """Directly exercises MCQVerificationService._resolve_item, the single
    source of truth for the decision table, independent of the LLM calls."""

    def test_matched_equals_stored_key_keeps_unchanged(self) -> None:
        item = _verifiable("q1", correct_index=1)
        derived = _derived(0, "B", 0.9)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=1, veto_index=None)
        assert verdict == "keep"

    def test_matched_differs_high_confidence_recorrects(self) -> None:
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "B", 0.9)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=1, veto_index=None)
        assert verdict == "recorrect"
        assert index == 1

    def test_matched_differs_low_confidence_keeps(self) -> None:
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "B", 0.4)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=1, veto_index=None)
        assert verdict == "questionable"

    def test_matched_differs_very_low_confidence_keeps_unchanged(self) -> None:
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "B", 0.2)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=1, veto_index=None)
        assert verdict == "keep"

    def test_no_match_high_confidence_no_veto_drops(self) -> None:
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "nothing here", 0.9)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=-1, veto_index=None)
        assert verdict == "drop"

    def test_no_match_mid_confidence_no_veto_is_questionable(self) -> None:
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "nothing here", 0.5)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=-1, veto_index=None)
        assert verdict == "questionable"

    def test_no_match_low_confidence_keeps(self) -> None:
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "nothing here", 0.3)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=-1, veto_index=None)
        assert verdict == "keep"

    def test_no_match_but_veto_present_recorrects(self) -> None:
        # This is the test that proves the one-way valve works: the adjudicator
        # wanted to drop, the deterministic matcher disagreed, and the question
        # survives, recorrected to the vetoed index.
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "matches option 2", 0.9)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=-1, veto_index=2)
        assert verdict == "recorrect"
        assert index == 2

    def test_derivable_false_keeps_regardless_of_everything_else(self) -> None:
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "", 0.9, derivable=False)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=-1, veto_index=None)
        assert verdict == "keep"

    def test_no_derivation_keeps(self) -> None:
        item = _verifiable("q1", correct_index=0)
        verdict, index = MCQVerificationService._resolve_item(item, None, matched=None, veto_index=None)
        assert verdict == "keep"

    def test_no_adjudication_verdict_keeps(self) -> None:
        item = _verifiable("q1", correct_index=0)
        derived = _derived(0, "something", 0.9)
        verdict, index = MCQVerificationService._resolve_item(item, derived, matched=None, veto_index=None)
        assert verdict == "keep"


class TestVerifyAndResolveOrchestration:
    """End-to-end through verify_and_resolve with the LLM calls mocked, so the
    sharding/caps/stats plumbing is exercised together with the decision table."""

    def _service_with(self, derive_return, adjudicate_return) -> MCQVerificationService:
        llm = LLMService()
        llm.derive_mcq_answers = AsyncMock(return_value=derive_return)  # type: ignore[method-assign]
        llm.adjudicate_mcq_matches = AsyncMock(return_value=adjudicate_return)  # type: ignore[method-assign]
        return MCQVerificationService(llm=llm)

    async def test_empty_items_short_circuits(self) -> None:
        service = self._service_with([], {})
        outcome = await service.verify_and_resolve([], "notes")
        assert outcome.kept == []
        assert outcome.dropped_keys == []
        assert outcome.stats["verified"] == 0

    async def test_matching_answer_keeps_all(self) -> None:
        items = [_verifiable("q0", options=["A", "B", "C", "D"], correct_index=0)]
        derive_return = [_derived(0, "A", 0.9)]
        adjudicate_return = {0: 0}
        service = self._service_with(derive_return, adjudicate_return)
        outcome = await service.verify_and_resolve(items, "notes")
        assert len(outcome.kept) == 1
        assert outcome.kept[0].correct_index == 0
        assert outcome.dropped_keys == []
        assert outcome.stats["kept"] == 1
        assert outcome.stats["dropped"] == 0

    async def test_recorrection_flows_through(self) -> None:
        items = [_verifiable("q0", options=["A", "B", "C", "D"], correct_index=0)]
        derive_return = [_derived(0, "C", 0.9)]
        adjudicate_return = {0: 2}
        service = self._service_with(derive_return, adjudicate_return)
        outcome = await service.verify_and_resolve(items, "notes")
        assert len(outcome.kept) == 1
        assert outcome.kept[0].correct_index == 2
        assert outcome.stats["recorrected"] == 1

    async def test_five_of_eight_drops_triggers_distrust(self) -> None:
        # 5/8 = 62.5% > the 50% cap: the whole result must be discarded, not
        # just capped down to the threshold.
        items = [_verifiable(f"q{i}", correct_index=0) for i in range(8)]
        derive_return = [_derived(i, "nothing", 0.9) for i in range(8)]
        # First 5 verify as a clean no-match (drop); last 3 keep as matched.
        adjudicate_return = {i: -1 for i in range(5)}
        adjudicate_return.update({i: 0 for i in range(5, 8)})
        service = self._service_with(derive_return, adjudicate_return)
        outcome = await service.verify_and_resolve(items, "notes")
        assert outcome.stats["distrusted"] is True
        assert len(outcome.kept) == 8
        assert outcome.dropped_keys == []

    async def test_small_batch_suppresses_drop(self) -> None:
        items = [_verifiable("q0", correct_index=0), _verifiable("q1", correct_index=0)]
        derive_return = [_derived(0, "nothing", 0.9), _derived(1, "A", 0.9)]
        adjudicate_return = {0: -1, 1: 0}
        service = self._service_with(derive_return, adjudicate_return)
        outcome = await service.verify_and_resolve(items, "notes")
        assert len(outcome.kept) == 2
        assert outcome.dropped_keys == []

    async def test_clean_drop_of_one_of_many(self) -> None:
        items = [_verifiable(f"q{i}", correct_index=0) for i in range(5)]
        derive_return = [_derived(i, "nothing" if i == 0 else "A", 0.9) for i in range(5)]
        adjudicate_return = {0: -1, 1: 0, 2: 0, 3: 0, 4: 0}
        service = self._service_with(derive_return, adjudicate_return)
        outcome = await service.verify_and_resolve(items, "notes")
        assert outcome.dropped_keys == ["q0"]
        assert len(outcome.kept) == 4
        assert outcome.stats["dropped"] == 1
        assert outcome.stats["distrusted"] is False

    async def test_adjudication_skipped_when_nothing_derivable(self) -> None:
        items = [_verifiable("q0", correct_index=0)]
        derive_return = [_derived(0, "", 0.0, derivable=False)]
        llm = LLMService()
        llm.derive_mcq_answers = AsyncMock(return_value=derive_return)  # type: ignore[method-assign]
        llm.adjudicate_mcq_matches = AsyncMock()
        service = MCQVerificationService(llm=llm)
        outcome = await service.verify_and_resolve(items, "notes")
        llm.adjudicate_mcq_matches.assert_not_called()
        assert len(outcome.kept) == 1


# ── Step 4: over-generation config ────────────────────────────────────────────

from src.services.mcq_verification_service import inflated_mcq_count  # noqa: E402


class TestInflatedMcqCount:

    def test_disabled_returns_request_unchanged(self, monkeypatch) -> None:
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_enabled", False)
        assert inflated_mcq_count(10) == 10

    def test_zero_or_negative_returns_unchanged(self) -> None:
        assert inflated_mcq_count(0) == 0
        assert inflated_mcq_count(-5) == -5

    def test_default_ratio_inflates_within_plus_five_cap(self, monkeypatch) -> None:
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_overgen_ratio", 1.3)
        # 10 * 1.3 = 13, within the +5 cap.
        assert inflated_mcq_count(10) == 13

    def test_large_request_capped_at_plus_five(self, monkeypatch) -> None:
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_overgen_ratio", 1.3)
        # 40 * 1.3 = 52, but the +5 cap wins first: 40 + 5 = 45.
        assert inflated_mcq_count(40) == 45

    def test_never_exceeds_fifty(self, monkeypatch) -> None:
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_overgen_ratio", 2.0)
        # A request already at the 50 ceiling cannot inflate further.
        assert inflated_mcq_count(50) == 50
        assert inflated_mcq_count(48) <= 50


# ── Step 5: verify_generated_mcqs (integration point A wrapper) ─────────────

from src.services.mcq_verification_service import VerificationOutcome  # noqa: E402


def _generated_mcq(question_text: str, correct_index: int) -> GeneratedMCQ:
    return GeneratedMCQ(question_text=question_text, options=["A", "B", "C", "D"], correct_index=correct_index)


class TestVerifyGeneratedMcqs:

    async def test_empty_input_short_circuits(self) -> None:
        service = MCQVerificationService(llm=LLMService())
        result, stats = await service.verify_generated_mcqs([], "notes")
        assert result == []
        assert stats == {"verified": 0}

    async def test_kept_questions_pass_through_unchanged(self) -> None:
        questions = [_generated_mcq("Q1?", 0), _generated_mcq("Q2?", 1)]
        service = MCQVerificationService(llm=LLMService())

        async def fake_verify_and_resolve(items, source_content, **kwargs):
            return VerificationOutcome(kept=items, dropped_keys=[], stats={"verified": 2, "kept": 2})

        service.verify_and_resolve = fake_verify_and_resolve  # type: ignore[method-assign]
        result, stats = await service.verify_generated_mcqs(questions, "notes")
        assert len(result) == 2
        assert result[0].question_text == "Q1?"
        assert stats["kept"] == 2

    async def test_recorrected_question_gets_new_index(self) -> None:
        questions = [_generated_mcq("Q1?", 0)]
        service = MCQVerificationService(llm=LLMService())

        async def fake_verify_and_resolve(items, source_content, **kwargs):
            recorrected = [replace(items[0], correct_index=2)]
            return VerificationOutcome(kept=recorrected, dropped_keys=[], stats={"recorrected": 1})

        service.verify_and_resolve = fake_verify_and_resolve  # type: ignore[method-assign]
        result, stats = await service.verify_generated_mcqs(questions, "notes")
        assert len(result) == 1
        assert result[0].correct_index == 2
        assert result[0].question_text == "Q1?"  # unchanged aside from the index

    async def test_dropped_question_is_removed(self) -> None:
        questions = [_generated_mcq("Q1?", 0), _generated_mcq("Q2?", 0)]
        service = MCQVerificationService(llm=LLMService())

        async def fake_verify_and_resolve(items, source_content, **kwargs):
            # Drop item at key 0 (Q1?), keep item at key 1 (Q2?).
            kept = [item for item in items if item.key == 1]
            return VerificationOutcome(kept=kept, dropped_keys=[0], stats={"dropped": 1})

        service.verify_and_resolve = fake_verify_and_resolve  # type: ignore[method-assign]
        result, stats = await service.verify_generated_mcqs(questions, "notes")
        assert len(result) == 1
        assert result[0].question_text == "Q2?"

    async def test_surplus_trimmed_to_requested_count(self) -> None:
        # Over-generation produced 3, only 2 were requested: trim the tail.
        questions = [_generated_mcq(f"Q{i}?", 0) for i in range(3)]
        service = MCQVerificationService(llm=LLMService())

        async def fake_verify_and_resolve(items, source_content, **kwargs):
            return VerificationOutcome(kept=items, dropped_keys=[], stats={})

        service.verify_and_resolve = fake_verify_and_resolve  # type: ignore[method-assign]
        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=2)
        assert len(result) == 2
        assert result[0].question_text == "Q0?"
        assert result[1].question_text == "Q1?"

    async def test_verification_exception_keeps_all_questions_unchanged(self) -> None:
        questions = [_generated_mcq("Q1?", 0)]
        service = MCQVerificationService(llm=LLMService())

        async def failing_verify_and_resolve(items, source_content, **kwargs):
            raise Exception("provider exploded")

        service.verify_and_resolve = failing_verify_and_resolve  # type: ignore[method-assign]
        result, stats = await service.verify_generated_mcqs(questions, "notes")
        assert result == questions
        assert "verification_error" in stats

    async def test_verification_timeout_keeps_all_questions_unchanged(self, monkeypatch) -> None:
        questions = [_generated_mcq("Q1?", 0)]
        service = MCQVerificationService(llm=LLMService())
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_timeout_seconds", 0.01)

        async def slow_verify_and_resolve(items, source_content, **kwargs):
            await asyncio.sleep(1)
            return VerificationOutcome(kept=items, dropped_keys=[], stats={})

        service.verify_and_resolve = slow_verify_and_resolve  # type: ignore[method-assign]
        result, stats = await service.verify_generated_mcqs(questions, "notes")
        assert result == questions
        assert "verification_error" in stats


# ── Step 6: regenerate_mcqs_for_topics (the repair generation call) ─────────

class TestRegenerateMcqsForTopics:

    async def test_zero_count_returns_empty_without_calling_provider(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock()  # type: ignore[method-assign]
        result = await llm.regenerate_mcqs_for_topics("notes", ["Old Q?"], count=0)
        assert result == []
        llm._complete_json.assert_not_called()

    async def test_happy_path_parses_replacements(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={
            "mcq": [
                {"question_text": "New Q1?", "options": ["A", "B", "C", "D"], "correct_index": 0},
                {"question_text": "New Q2?", "options": ["A", "B", "C", "D"], "correct_index": 1},
            ],
            "frq": [],
        })
        result = await llm.regenerate_mcqs_for_topics("notes text", ["Old Q1?", "Old Q2?"], count=2)
        assert len(result) == 2
        assert result[0].question_text == "New Q1?"

    async def test_provider_exception_returns_empty(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(side_effect=Exception("provider down"))
        result = await llm.regenerate_mcqs_for_topics("notes", ["Old Q?"], count=1)
        assert result == []

    async def test_malformed_json_returns_empty(self) -> None:
        llm = LLMService()
        llm._complete_json = AsyncMock(return_value={"wrong_key": "oops"})
        result = await llm.regenerate_mcqs_for_topics("notes", ["Old Q?"], count=1)
        assert result == []

    async def test_prompt_does_not_call_it_wrong_or_hallucinated(self) -> None:
        # Models over-correct on "these were wrong" framing into trivially easy
        # questions; the prompt must frame the repair as coverage, never as a
        # correction. The shared prompt builder legitimately says "wrong
        # answer options" (distractor guidance) elsewhere, so this checks for
        # the specific accusatory framing, not the bare word "wrong".
        llm = LLMService()
        captured: list[str] = []

        async def capture(prompt: str, provider=None):
            captured.append(prompt)
            return {"mcq": [], "frq": []}

        llm._complete_json = capture  # type: ignore[method-assign]
        await llm.regenerate_mcqs_for_topics("notes", ["Old Q?"], count=1)
        assert len(captured) == 1
        lowered = captured[0].lower()
        assert "hallucinat" not in lowered
        assert "were wrong" not in lowered
        assert "incorrect answer" not in lowered
        assert "failed verification" not in lowered
        # The framing must be coverage: same concepts, new wording.
        assert "cover these same concepts" in lowered

    async def test_math_variant_uses_math_prompt_builder(self) -> None:
        llm = LLMService()
        captured: list[str] = []

        async def capture(prompt: str, provider=None):
            captured.append(prompt)
            return {"mcq": [], "frq": []}

        llm._complete_json = capture  # type: ignore[method-assign]
        await llm.regenerate_mcqs_for_topics("notes", ["Old Q?"], count=1, variant="math")
        # The math prompt builder includes the KaTeX rendering rules block.
        assert "KATEX" in captured[0]


# ── Step 6: the repair round in verify_generated_mcqs ────────────────────────

def _outcome(kept, dropped_keys=None, questionable_keys=None, stats=None) -> VerificationOutcome:
    return VerificationOutcome(
        kept=kept,
        dropped_keys=dropped_keys or [],
        questionable_keys=questionable_keys or [],
        stats=stats or {"calls": 2},
    )


def _verifiable_from(index: int, question: GeneratedMCQ) -> VerifiableMCQ:
    return VerifiableMCQ(key=index, question_text=question.question_text, options=question.options, correct_index=question.correct_index)


class TestRepairRound:

    def _service(self) -> MCQVerificationService:
        return MCQVerificationService(llm=LLMService())

    async def test_surplus_covers_drop_skips_repair_entirely(self) -> None:
        # 3 generated (over-generation), 1 dropped, 2 survive >= the 2 requested:
        # the shortfall is zero, so regenerate_mcqs_for_topics must never fire.
        questions = [_generated_mcq(f"Q{i}?", 0) for i in range(3)]
        service = self._service()
        outcome = _outcome(kept=[_verifiable_from(1, questions[1]), _verifiable_from(2, questions[2])], dropped_keys=[0])
        service.verify_and_resolve = AsyncMock(return_value=outcome)  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock()  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=2)

        service._llm.regenerate_mcqs_for_topics.assert_not_called()
        assert len(result) == 2
        assert stats["repaired"] == 0
        assert stats["repair_failed"] == 0

    async def test_two_drops_no_surplus_triggers_one_repair_call(self) -> None:
        questions = [_generated_mcq(f"Q{i}?", 0) for i in range(2)]
        service = self._service()
        main_outcome = _outcome(kept=[], dropped_keys=[0, 1], stats={"calls": 2})
        replacements = [_generated_mcq("New Q0?", 0), _generated_mcq("New Q1?", 1)]
        repair_outcome = _outcome(
            kept=[_verifiable_from(0, replacements[0]), _verifiable_from(1, replacements[1])],
            stats={"calls": 2},
        )
        service.verify_and_resolve = AsyncMock(side_effect=[main_outcome, repair_outcome])  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock(return_value=replacements)  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=2)

        service._llm.regenerate_mcqs_for_topics.assert_awaited_once()
        assert service._llm.regenerate_mcqs_for_topics.call_args.kwargs["count"] == 2
        assert service.verify_and_resolve.await_count == 2
        assert len(result) == 2
        assert stats["repaired"] == 2
        # 2 (main) + 1 (repair generation) + 2 (repair verify) = 5, the bound
        # this service contributes toward the plan's 6-call worst case (the
        # 6th being the original generation call, made by the caller before
        # verify_generated_mcqs is ever invoked).
        assert stats["calls"] == 5

    async def test_failed_replacement_leaves_hole_empty_and_is_never_re_repaired(self) -> None:
        questions = [_generated_mcq("Q0?", 0)]
        service = self._service()
        main_outcome = _outcome(kept=[], dropped_keys=[0])
        replacement = [_generated_mcq("New Q0?", 0)]
        # The replacement itself verifies as a drop (adjudicator/matcher rejects it).
        repair_outcome = _outcome(kept=[], dropped_keys=[0])
        service.verify_and_resolve = AsyncMock(side_effect=[main_outcome, repair_outcome])  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock(return_value=replacement)  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=1)

        assert result == []  # hole stays empty
        assert stats["repaired"] == 0
        assert stats["repair_failed"] == 1
        # Only two verify_and_resolve calls total: no second repair attempt.
        assert service.verify_and_resolve.await_count == 2

    async def test_replacement_verifying_questionable_counts_as_failed_repair(self) -> None:
        # Asymmetry vs originals: a replacement that verifies "questionable"
        # is treated as a failed repair, not kept, because repairing a repair
        # would be a second round.
        questions = [_generated_mcq("Q0?", 0)]
        service = self._service()
        main_outcome = _outcome(kept=[], dropped_keys=[0])
        replacement = [_generated_mcq("New Q0?", 0)]
        repair_verifiable = _verifiable_from(0, replacement[0])
        repair_outcome = _outcome(kept=[repair_verifiable], questionable_keys=[0])
        service.verify_and_resolve = AsyncMock(side_effect=[main_outcome, repair_outcome])  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock(return_value=replacement)  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=1)

        assert result == []
        assert stats["repair_failed"] == 1
        assert stats["repaired"] == 0

    async def test_questionable_original_replaced_by_clean_repair(self) -> None:
        questions = [_generated_mcq("Q0?", 0), _generated_mcq("Q1?", 0)]
        service = self._service()
        # Q0 kept normally, Q1 kept but flagged questionable.
        main_outcome = _outcome(
            kept=[_verifiable_from(0, questions[0]), _verifiable_from(1, questions[1])],
            questionable_keys=[1],
        )
        replacement = [_generated_mcq("Better Q1?", 2)]
        repair_outcome = _outcome(kept=[_verifiable_from(0, replacement[0])])
        service.verify_and_resolve = AsyncMock(side_effect=[main_outcome, repair_outcome])  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock(return_value=replacement)  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=2)

        assert len(result) == 2
        assert result[1].question_text == "Better Q1?"
        assert stats["repaired"] == 1

    async def test_questionable_original_kept_when_replacement_fails(self) -> None:
        questions = [_generated_mcq("Q0?", 0)]
        service = self._service()
        main_outcome = _outcome(kept=[_verifiable_from(0, questions[0])], questionable_keys=[0])
        replacement = [_generated_mcq("Try2?", 0)]
        repair_outcome = _outcome(kept=[], dropped_keys=[0])
        service.verify_and_resolve = AsyncMock(side_effect=[main_outcome, repair_outcome])  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock(return_value=replacement)  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=1)

        assert len(result) == 1
        assert result[0].question_text == "Q0?"  # original survives unchanged
        assert stats["repair_failed"] == 1

    async def test_distrusted_batch_skips_repair(self) -> None:
        questions = [_generated_mcq(f"Q{i}?", 0) for i in range(4)]
        service = self._service()
        outcome = _outcome(
            kept=[_verifiable_from(i, q) for i, q in enumerate(questions)],
            stats={"distrusted": True, "calls": 2},
        )
        service.verify_and_resolve = AsyncMock(return_value=outcome)  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock()  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=4)

        service._llm.regenerate_mcqs_for_topics.assert_not_called()
        assert len(result) == 4

    async def test_repair_disabled_flag_skips_repair(self, monkeypatch) -> None:
        monkeypatch.setattr("src.services.mcq_verification_service.settings.mcq_verification_repair_enabled", False)
        questions = [_generated_mcq("Q0?", 0)]
        service = self._service()
        outcome = _outcome(kept=[], dropped_keys=[0])
        service.verify_and_resolve = AsyncMock(return_value=outcome)  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock()  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=1)

        service._llm.regenerate_mcqs_for_topics.assert_not_called()
        assert result == []

    async def test_repair_queue_capped_at_five_drops_before_questionables(self) -> None:
        # 8 dropped, 2 questionable, requested_count high enough that the
        # shortfall alone exceeds the cap: only 5 drops enter the queue and
        # zero questionables get a slot.
        questions = [_generated_mcq(f"Q{i}?", 0) for i in range(10)]
        service = self._service()
        main_outcome = _outcome(kept=[], dropped_keys=list(range(8)), questionable_keys=[8, 9])
        replacements = [_generated_mcq(f"New{i}?", 0) for i in range(5)]
        repair_outcome = _outcome(kept=[_verifiable_from(i, r) for i, r in enumerate(replacements)])
        service.verify_and_resolve = AsyncMock(side_effect=[main_outcome, repair_outcome])  # type: ignore[method-assign]
        service._llm.regenerate_mcqs_for_topics = AsyncMock(return_value=replacements)  # type: ignore[method-assign]

        result, stats = await service.verify_generated_mcqs(questions, "notes", requested_count=10)

        assert service._llm.regenerate_mcqs_for_topics.call_args.kwargs["count"] == 5
        assert stats["repaired"] == 5


# ── Steps 7-8: math and coding variant prompt framing for derive_mcq_answers ─

class TestDeriveMcqAnswersVariantFraming:

    async def _capture_prompt(self, **derive_kwargs) -> str:
        llm = LLMService()
        captured: list[str] = []

        async def capture(prompt: str, provider=None):
            captured.append(prompt)
            return {"answers": []}

        llm._complete_json = capture  # type: ignore[method-assign]
        await llm.derive_mcq_answers(["Q1?"], "source material", **derive_kwargs)
        assert len(captured) == 1
        return captured[0]

    async def test_default_variant_is_prose(self) -> None:
        prompt = await self._capture_prompt()
        assert "expert subject tutor" in prompt

    async def test_math_variant_asks_for_latex_and_bans_prose_answers(self) -> None:
        prompt = await self._capture_prompt(variant="math")
        assert "expert math tutor" in prompt
        assert "LaTeX" in prompt
        assert "expert subject tutor" not in prompt

    async def test_coding_variant_asks_for_exact_output_and_bans_execution(self) -> None:
        prompt = await self._capture_prompt(variant="coding")
        assert "expert programmer" in prompt
        assert "Never execute anything" in prompt
        assert "expert math tutor" not in prompt

    async def test_coding_variant_includes_language_line_when_given(self) -> None:
        prompt = await self._capture_prompt(variant="coding", coding_language="Python")
        assert "LANGUAGE: Python" in prompt

    async def test_coding_variant_omits_language_line_when_not_given(self) -> None:
        prompt = await self._capture_prompt(variant="coding")
        assert "LANGUAGE:" not in prompt

    async def test_unknown_variant_falls_back_to_prose(self) -> None:
        prompt = await self._capture_prompt(variant="not_a_real_variant")
        assert "expert subject tutor" in prompt
