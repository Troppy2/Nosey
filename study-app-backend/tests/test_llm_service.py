"""
Unit tests for LLMService.

Covers: Groq HTTP paths, Ollama fallback dispatch, metadata stripping,
validators, JSON parsing, fallback generators, and end-to-end question /
flashcard / grading flows with mocked HTTP.
"""
from __future__ import annotations

import json
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.llm_service import (
    GeneratedFRQ,
    GeneratedFlashcard,
    GeneratedMCQ,
    LLMService,
)
from src.utils.exceptions import LLMException

# ── shared fixtures ────────────────────────────────────────────────────────────

FAKE_KEY = "gsk_test_fake_key_for_unit_tests"

# Realistic notes used across multiple tests
SAMPLE_NOTES = (
    "A transaction is a logical unit of database processing. "
    "Transactions must satisfy four ACID properties: Atomicity, Consistency, "
    "Isolation, and Durability. Atomicity ensures all operations complete or "
    "none do. Durability means committed data persists even after a crash."
)

# Representative MCQ/FRQ items that pass all validators
VALID_MCQ = {
    "question_text": "What does Atomicity guarantee in a database transaction?",
    "options": [
        "All operations complete or none do",
        "Transactions execute in sequence",
        "Data is replicated to multiple nodes",
        "Queries run faster with indexes",
    ],
    "correct_index": 0,
}

VALID_FRQ = {
    "question_text": "Explain what Durability means in the context of ACID properties.",
    "expected_answer": (
        "Durability guarantees that once a transaction is committed, its changes "
        "persist permanently even if the system crashes immediately afterward."
    ),
}

# ── httpx mock helper ──────────────────────────────────────────────────────────

@contextmanager
def mock_httpx_post(json_body: dict):
    """Patch httpx.AsyncClient so every .post() returns a response with json_body."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = json_body

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("src.services.llm_service.httpx.AsyncClient", return_value=mock_cm):
        yield mock_client


def groq_json_body(payload: dict) -> dict:
    """Wrap payload in the Groq chat completions JSON shape."""
    return {"choices": [{"message": {"content": json.dumps(payload)}}]}


def groq_text_body(text: str) -> dict:
    """Wrap plain text in the Groq chat completions JSON shape."""
    return {"choices": [{"message": {"content": text}}]}


def fake_settings(groq_key: str | None = FAKE_KEY, timeout: int = 30, max_tokens: int = 200):
    """Return a mock settings object with common LLM fields."""
    s = MagicMock()
    s.groq_api_key = groq_key
    s.llm_timeout_seconds = timeout
    s.llm_max_tokens = max_tokens
    s.ollama_base_url = "http://localhost:11434"
    s.ollama_model = "llama3.1:8b"
    s.llm_provider = "auto"
    return s


# ── _strip_metadata ────────────────────────────────────────────────────────────

class TestStripMetadata:
    svc = LLMService()

    def test_removes_yaml_frontmatter_block(self):
        notes = "---\ntitle: DB Notes\ntags: [csci, db]\ncreated: 2026-04-26\n---\nReal content here."
        result = self.svc._strip_metadata(notes)
        assert "title:" not in result
        assert "tags:" not in result
        assert "Real content here." in result

    def test_removes_document_bracket_markers(self):
        notes = "[CSCI2050_Notes.md]\nActual study content follows."
        result = self.svc._strip_metadata(notes)
        assert "[CSCI2050_Notes.md]" not in result
        assert "Actual study content follows." in result

    def test_removes_inline_dash_document_markers(self):
        notes = "--- Document 1: CSCI2050_Test3_Notes.md ---\nReal notes start here."
        result = self.svc._strip_metadata(notes)
        assert "Document 1" not in result
        assert "Real notes start here." in result

    def test_removes_standalone_horizontal_rules(self):
        notes = "Section A.\n\n---\n\nSection B."
        result = self.svc._strip_metadata(notes)
        assert "Section A." in result
        assert "Section B." in result
        assert "\n---\n" not in result

    def test_handles_multiple_documents_concatenated(self):
        notes = (
            "[file1.md]\n--- Document 1: file1.md ---\n---\ntitle: First\n---\n"
            "Content of file one.\n\n---\n\n"
            "[file2.md]\n--- Document 2: file2.md ---\n---\ntitle: Second\n---\n"
            "Content of file two."
        )
        result = self.svc._strip_metadata(notes)
        assert "Content of file one." in result
        assert "Content of file two." in result
        assert "title:" not in result

    def test_preserves_content_with_no_metadata(self):
        notes = "A transaction is a logical unit of work. ACID properties ensure correctness."
        assert self.svc._strip_metadata(notes) == notes


# ── _sentences ─────────────────────────────────────────────────────────────────

class TestSentences:
    svc = LLMService()

    def test_strips_metadata_before_splitting(self):
        notes = "---\ntitle: Notes\n---\n# Chapter 1\n" + SAMPLE_NOTES
        sentences = self.svc._sentences(notes)
        assert all("---" not in s for s in sentences)
        assert all(not s.startswith("#") for s in sentences)

    def test_excludes_sentences_under_20_chars(self):
        notes = "OK. " + SAMPLE_NOTES
        sentences = self.svc._sentences(notes)
        assert all(len(s) > 20 for s in sentences)

    def test_caps_output_at_50_sentences(self):
        notes = " ".join(f"Sentence number {i} is long enough to pass the filter." for i in range(100))
        assert len(self.svc._sentences(notes)) <= 50

    def test_returns_real_content_sentences(self):
        sentences = self.svc._sentences(SAMPLE_NOTES)
        assert any("transaction" in s.lower() for s in sentences)


# ── _is_valid_mcq ──────────────────────────────────────────────────────────────

class TestIsValidMCQ:
    svc = LLMService()
    good_opts = ["Atomicity", "Consistency", "Isolation", "Durability"]

    def test_accepts_well_formed_question(self):
        item = {"question_text": "What does ACID stand for?", "options": self.good_opts, "correct_index": 0}
        assert self.svc._is_valid_mcq(item) is True

    def test_rejects_fallback_template_pattern(self):
        item = {"question_text": "Which statement is supported by the notes? (1)", "options": self.good_opts, "correct_index": 0}
        assert self.svc._is_valid_mcq(item) is False

    def test_rejects_raw_markdown_in_options(self):
        bad_opts = ["--- Document 1: file.md ---", "B", "C", "D"]
        item = {"question_text": "What is X?", "options": bad_opts, "correct_index": 0}
        assert self.svc._is_valid_mcq(item) is False

    def test_rejects_header_line_in_options(self):
        bad_opts = ["# This is a markdown header", "B", "C", "D"]
        item = {"question_text": "What is X?", "options": bad_opts, "correct_index": 0}
        assert self.svc._is_valid_mcq(item) is False

    def test_rejects_option_over_400_chars(self):
        long_opt = "x" * 401
        item = {"question_text": "What?", "options": [long_opt, "B", "C", "D"], "correct_index": 0}
        assert self.svc._is_valid_mcq(item) is False

    def test_rejects_too_few_options(self):
        item = {"question_text": "What?", "options": ["A", "B", "C"], "correct_index": 0}
        assert self.svc._is_valid_mcq(item) is False

    def test_rejects_non_dict(self):
        assert self.svc._is_valid_mcq("not a dict") is False
        assert self.svc._is_valid_mcq(None) is False


# ── _is_valid_frq ──────────────────────────────────────────────────────────────

class TestIsValidFRQ:
    svc = LLMService()

    def test_accepts_well_formed_question(self):
        item = {"question_text": "Explain ACID properties.", "expected_answer": "ACID ensures data integrity."}
        assert self.svc._is_valid_frq(item) is True

    def test_rejects_fallback_template(self):
        item = {"question_text": "Explain this idea from the notes: some raw text", "expected_answer": "answer"}
        assert self.svc._is_valid_frq(item) is False

    def test_rejects_dash_marker_in_question(self):
        item = {"question_text": "--- Document 1 --- What is isolation?", "expected_answer": "answer"}
        assert self.svc._is_valid_frq(item) is False

    def test_rejects_empty_answer(self):
        item = {"question_text": "What is a transaction?", "expected_answer": ""}
        assert self.svc._is_valid_frq(item) is False

    def test_rejects_empty_question(self):
        item = {"question_text": "", "expected_answer": "Some answer."}
        assert self.svc._is_valid_frq(item) is False

    def test_rejects_non_dict(self):
        assert self.svc._is_valid_frq(None) is False
        assert self.svc._is_valid_frq(42) is False


# ── _loads_json ────────────────────────────────────────────────────────────────

class TestLoadsJson:
    svc = LLMService()

    def test_parses_clean_json(self):
        assert self.svc._loads_json('{"mcq": [], "frq": []}') == {"mcq": [], "frq": []}

    def test_extracts_json_from_surrounding_prose(self):
        raw = 'Sure, here you go:\n{"key": "value"}\nLet me know if that helps.'
        assert self.svc._loads_json(raw) == {"key": "value"}

    def test_raises_on_completely_invalid_input(self):
        with pytest.raises(Exception):
            self.svc._loads_json("This is just plain text with no JSON at all.")

    def test_raises_on_json_array_instead_of_object(self):
        with pytest.raises(ValueError, match="not a JSON object"):
            self.svc._loads_json("[1, 2, 3]")


# ── _fallback_grade ────────────────────────────────────────────────────────────

class TestFallbackGrade:
    svc = LLMService()

    def test_high_keyword_overlap_is_correct(self):
        expected = "Atomicity ensures all database operations complete or none execute during transaction."
        user = "Atomicity means all database operations complete or none execute in transaction."
        grade = self.svc._fallback_grade(expected, user)
        assert grade.is_correct is True
        assert grade.flagged_uncertain is True

    def test_low_keyword_overlap_is_incorrect(self):
        expected = "Atomicity ensures all operations complete or none do."
        user = "Paris is the capital city of France near the river."
        grade = self.svc._fallback_grade(expected, user)
        assert grade.is_correct is False
        assert 0.0 <= grade.confidence <= 1.0

    def test_confidence_clamped_between_0_and_1(self):
        grade = self.svc._fallback_grade("word " * 20, "word " * 20)
        assert 0.0 <= grade.confidence <= 1.0


# ── _fallback_questions ────────────────────────────────────────────────────────

class TestFallbackQuestions:
    svc = LLMService()

    def test_returns_requested_counts(self):
        mcq, frq = self.svc._fallback_questions(SAMPLE_NOTES, count_mcq=4, count_frq=2)
        assert len(mcq) == 4
        assert len(frq) == 2

    def test_mcq_options_contain_no_raw_markdown(self):
        mcq, _ = self.svc._fallback_questions(SAMPLE_NOTES, count_mcq=3, count_frq=0)
        for q in mcq:
            for opt in q.options:
                assert "---" not in opt
                assert not opt.startswith("#")

    def test_all_items_are_correct_types(self):
        mcq, frq = self.svc._fallback_questions(SAMPLE_NOTES, count_mcq=2, count_frq=2)
        assert all(isinstance(q, GeneratedMCQ) for q in mcq)
        assert all(isinstance(q, GeneratedFRQ) for q in frq)

    def test_handles_empty_notes_without_crashing(self):
        mcq, frq = self.svc._fallback_questions("", count_mcq=2, count_frq=1)
        assert len(mcq) == 2
        assert len(frq) == 1

    def test_math_fallback_returns_requested_counts(self):
        mcq, frq = self.svc._fallback_math_questions(SAMPLE_NOTES, count_mcq=3, count_frq=2)
        assert len(mcq) == 3
        assert len(frq) == 2

    def test_math_fallback_outputs_math_only_content(self):
        mcq, frq = self.svc._fallback_math_questions("", count_mcq=2, count_frq=1)
        for q in mcq:
            assert q.question_text.startswith("Solve for $x$")
            assert len(q.options) == 4
            assert all(option.startswith("$x = ") for option in q.options)
        assert frq[0].question_text.startswith("Solve for $x$")


# ── _complete_groq ─────────────────────────────────────────────────────────────

class TestCompleteGroq:
    svc = LLMService()

    async def test_calls_correct_url_and_auth_header(self):
        payload = {"mcq": [], "frq": []}
        with mock_httpx_post(groq_json_body(payload)) as mock_client:
            with patch("src.services.llm_service.settings", fake_settings()):
                result = await self.svc._complete_groq("test prompt")

        call = mock_client.post.call_args
        assert call.args[0] == "https://api.groq.com/openai/v1/chat/completions"
        assert call.kwargs["headers"]["Authorization"] == f"Bearer {FAKE_KEY}"
        assert result == payload

    async def test_uses_correct_model_and_json_format(self):
        with mock_httpx_post(groq_json_body({"k": "v"})) as mock_client:
            with patch("src.services.llm_service.settings", fake_settings()):
                await self.svc._complete_groq("prompt")

        body = mock_client.post.call_args.kwargs["json"]
        assert body["model"] == "llama-3.1-8b-instant"
        assert body["response_format"] == {"type": "json_object"}
        assert body["temperature"] == 0.2

    async def test_propagates_http_error(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = Exception("HTTP 429 Too Many Requests")
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("src.services.llm_service.httpx.AsyncClient", return_value=mock_cm):
            with patch("src.services.llm_service.settings", fake_settings()):
                with pytest.raises(Exception, match="429"):
                    await self.svc._complete_groq("prompt")


# ── _complete_text_groq ────────────────────────────────────────────────────────

class TestCompleteTextGroq:
    svc = LLMService()

    async def test_returns_plain_text_response(self):
        response_text = "Atomicity means all-or-nothing execution of a transaction."
        with mock_httpx_post(groq_text_body(response_text)) as _:
            with patch("src.services.llm_service.settings", fake_settings()):
                result = await self.svc._complete_text_groq("Explain atomicity")
        assert result == response_text

    async def test_uses_temperature_07_and_no_json_format(self):
        with mock_httpx_post(groq_text_body("response")) as mock_client:
            with patch("src.services.llm_service.settings", fake_settings()):
                await self.svc._complete_text_groq("prompt")

        body = mock_client.post.call_args.kwargs["json"]
        assert body["temperature"] == 0.7
        assert "response_format" not in body

    async def test_calls_same_endpoint_as_complete_groq(self):
        with mock_httpx_post(groq_text_body("ok")) as mock_client:
            with patch("src.services.llm_service.settings", fake_settings()):
                await self.svc._complete_text_groq("prompt")
        assert mock_client.post.call_args.args[0] == "https://api.groq.com/openai/v1/chat/completions"

    async def test_propagates_http_error(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = Exception("HTTP 401 Unauthorized")
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cm.__aexit__ = AsyncMock(return_value=False)

        with patch("src.services.llm_service.httpx.AsyncClient", return_value=mock_cm):
            with patch("src.services.llm_service.settings", fake_settings()):
                with pytest.raises(Exception, match="401"):
                    await self.svc._complete_text_groq("prompt")


# ── _complete_json dispatch ────────────────────────────────────────────────────

class TestCompleteJsonDispatch:

    async def test_prefers_groq_when_key_is_set(self):
        svc = LLMService()
        svc._complete_groq = AsyncMock(return_value={"result": "groq"})
        svc._complete_ollama = AsyncMock(return_value={"result": "ollama"})

        with patch("src.services.llm_service.settings", fake_settings(groq_key=FAKE_KEY)):
            result = await svc._complete_json("prompt")

        svc._complete_groq.assert_awaited_once()
        svc._complete_ollama.assert_not_awaited()
        assert result == {"result": "groq"}

    async def test_falls_back_to_ollama_when_key_is_none(self):
        svc = LLMService()
        svc._complete_groq = AsyncMock(return_value={"result": "groq"})
        svc._complete_ollama = AsyncMock(return_value={"result": "ollama"})

        with patch("src.services.llm_service.settings", fake_settings(groq_key=None)):
            result = await svc._complete_json("prompt")

        svc._complete_ollama.assert_awaited_once()
        svc._complete_groq.assert_not_awaited()
        assert result == {"result": "ollama"}


# ── call_kojo ──────────────────────────────────────────────────────────────────

class TestCallKojo:

    async def test_uses_groq_text_when_key_set(self):
        svc = LLMService()
        svc._complete_text_groq = AsyncMock(return_value="Groq answer")
        svc._complete_text_ollama = AsyncMock(return_value="Ollama answer")

        with patch("src.services.llm_service.settings", fake_settings(groq_key=FAKE_KEY)):
            result = await svc.call_kojo("Explain transactions")

        assert result == "Groq answer"
        svc._complete_text_groq.assert_awaited_once()
        svc._complete_text_ollama.assert_not_awaited()

    async def test_uses_ollama_text_when_no_key(self):
        svc = LLMService()
        svc._complete_text_groq = AsyncMock(return_value="Groq answer")
        svc._complete_text_ollama = AsyncMock(return_value="Ollama answer")
        svc._candidate_providers = AsyncMock(return_value=["ollama"])

        with patch("src.services.llm_service.settings", fake_settings(groq_key=None)):
            result = await svc.call_kojo("Explain transactions")

        assert result == "Ollama answer"
        svc._complete_text_ollama.assert_awaited_once()

    async def test_wraps_any_error_as_llm_exception(self):
        svc = LLMService()
        svc._complete_text_groq = AsyncMock(side_effect=RuntimeError("connection refused"))

        with patch("src.services.llm_service.settings", fake_settings(groq_key=FAKE_KEY)):
            with pytest.raises(LLMException, match="Kojo error"):
                await svc.call_kojo("question", provider="groq")

    async def test_llm_exception_passes_through_unwrapped(self):
        svc = LLMService()
        svc._complete_text_groq = AsyncMock(side_effect=LLMException("already wrapped"))

        with patch("src.services.llm_service.settings", fake_settings(groq_key=FAKE_KEY)):
            with pytest.raises(LLMException, match="already wrapped"):
                await svc.call_kojo("question")


# ── generate_test_questions ────────────────────────────────────────────────────

# Extraction response returned by the first _complete_json call
EXTRACTION_RESP = {
    "title": "Database Transactions",
    "terms": [{"term": "Atomicity", "definition": "All-or-nothing execution"}],
    "concepts": ["ACID properties ensure transaction correctness"],
}


class TestGenerateTestQuestions:

    async def test_mcq_only_mode_sets_frq_count_to_zero(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(side_effect=[
            EXTRACTION_RESP,
            {"mcq": [VALID_MCQ] * 3, "frq": []},
        ])
        mcq, frq = await svc.generate_test_questions(SAMPLE_NOTES, "MCQ_only", count_mcq=3)
        assert len(mcq) == 3
        assert len(frq) == 0

    async def test_frq_only_mode_sets_mcq_count_to_zero(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(side_effect=[
            EXTRACTION_RESP,
            {"mcq": [], "frq": [VALID_FRQ] * 2},
        ])
        mcq, frq = await svc.generate_test_questions(SAMPLE_NOTES, "FRQ_only", count_frq=2)
        assert len(mcq) == 0
        assert len(frq) == 2

    async def test_mixed_mode_returns_both(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(side_effect=[
            EXTRACTION_RESP,
            {"mcq": [VALID_MCQ] * 5, "frq": [VALID_FRQ] * 3},
        ])
        mcq, frq = await svc.generate_test_questions(SAMPLE_NOTES, "mixed", count_mcq=5, count_frq=3)
        assert len(mcq) == 5
        assert len(frq) == 3
        assert all(isinstance(q, GeneratedMCQ) for q in mcq)
        assert all(isinstance(q, GeneratedFRQ) for q in frq)

    async def test_falls_back_when_generation_fails(self):
        svc = LLMService()
        svc._candidate_providers = AsyncMock(return_value=["groq"])
        svc._complete_json = AsyncMock(side_effect=[
            EXTRACTION_RESP,
            Exception("Groq timeout"),
        ])
        mcq, frq = await svc.generate_test_questions(SAMPLE_NOTES, "mixed", count_mcq=2, count_frq=1)
        # Should still return the right counts via deterministic fallback
        assert len(mcq) == 2
        assert len(frq) == 1

    async def test_filters_out_invalid_questions_from_llm(self):
        """Invalid LLM question is dropped; the valid one is kept; total is filled to count."""
        invalid_mcq = {
            "question_text": "Which statement is supported by the notes? (1)",
            "options": ["raw markdown --- text", "B", "C", "D"],
            "correct_index": 0,
        }
        svc = LLMService()
        svc._candidate_providers = AsyncMock(return_value=["groq"])
        svc._complete_json = AsyncMock(side_effect=[
            EXTRACTION_RESP,
            {"mcq": [VALID_MCQ, invalid_mcq], "frq": [VALID_FRQ]},
        ])
        mcq, _ = await svc.generate_test_questions(SAMPLE_NOTES, "mixed", count_mcq=2, count_frq=1)
        # Final count is still 2 (invalid dropped, fallback fills the gap)
        assert len(mcq) == 2
        # The valid LLM question must be present
        assert any(VALID_MCQ["question_text"] in q.question_text for q in mcq)

    async def test_metadata_stripped_before_extraction(self):
        """Frontmatter in notes should not reach the LLM prompts."""
        notes_with_meta = (
            "[notes.md]\n--- Document 1: notes.md ---\n"
            "---\ntitle: CSCI DB\n---\n" + SAMPLE_NOTES
        )
        svc = LLMService()
        svc._candidate_providers = AsyncMock(return_value=["groq"])
        captured_prompts: list[str] = []

        async def capture_complete_json(prompt: str, provider=None) -> dict:
            captured_prompts.append(prompt)
            if len(captured_prompts) == 1:
                return EXTRACTION_RESP
            return {"mcq": [VALID_MCQ], "frq": [VALID_FRQ]}

        svc._complete_json = capture_complete_json  # type: ignore[method-assign]
        await svc.generate_test_questions(notes_with_meta, "mixed", count_mcq=1, count_frq=1)

        for prompt in captured_prompts:
            assert "Document 1:" not in prompt
            assert "title: CSCI" not in prompt

    async def test_math_mode_rejects_non_math_llm_and_uses_math_fallback(self):
        svc = LLMService()
        svc._candidate_providers = AsyncMock(return_value=["groq"])
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ], "frq": [VALID_FRQ]})
        mcq, frq = await svc.generate_test_questions(
            SAMPLE_NOTES,
            "mixed",
            count_mcq=1,
            count_frq=1,
            is_math_mode=True,
        )
        assert len(mcq) == 1
        assert len(frq) == 1
        assert mcq[0].question_text.startswith("Solve for $x$")
        assert all(option.startswith("$x = ") for option in mcq[0].options)
        assert frq[0].question_text.startswith("Solve for $x$")

    async def test_math_mode_exception_path_uses_math_fallback(self):
        svc = LLMService()
        svc._candidate_providers = AsyncMock(return_value=["groq"])
        svc._complete_json = AsyncMock(side_effect=Exception("LLM unavailable"))
        mcq, frq = await svc.generate_test_questions(
            SAMPLE_NOTES,
            "mixed",
            count_mcq=2,
            count_frq=1,
            is_math_mode=True,
        )
        assert len(mcq) == 2
        assert len(frq) == 1
        assert all(q.question_text.startswith("Solve for $x$") for q in mcq)

    async def test_generation_meta_marks_fallback_for_math_exception(self):
        svc = LLMService()
        svc._candidate_providers = AsyncMock(return_value=["groq"])
        svc._complete_json = AsyncMock(side_effect=Exception("rate limited"))
        await svc.generate_test_questions(
            SAMPLE_NOTES,
            "mixed",
            count_mcq=1,
            count_frq=1,
            is_math_mode=True,
        )
        meta = svc.get_last_generation_meta()
        assert meta["fallback_used"] is True
        assert meta["fallback_reason"] == "llm_exception_math"
        assert meta["note_grounded"] is False

    async def test_generation_meta_includes_retrieval_stats(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(side_effect=[
            EXTRACTION_RESP,
            {"mcq": [VALID_MCQ], "frq": [VALID_FRQ]},
        ])
        await svc.generate_test_questions(SAMPLE_NOTES, "mixed", count_mcq=1, count_frq=1)
        meta = svc.get_last_generation_meta()
        assert meta["retrieval_enabled"] is True
        assert int(meta["retrieval_total_chunks"]) >= 1
        assert int(meta["retrieval_selected_chunks"]) >= 1
        assert int(meta["retrieval_top_k"]) >= 1


# ── grade_frq_answer ───────────────────────────────────────────────────────────

class TestGradeFRQAnswer:

    async def test_returns_correct_grade_from_llm(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={
            "is_correct": True,
            "feedback": "Well explained.",
            "flagged_uncertain": False,
            "confidence": 0.92,
        })
        grade = await svc.grade_frq_answer(SAMPLE_NOTES, "What is atomicity?", "expected", "user answer")
        assert grade.is_correct is True
        assert grade.confidence == pytest.approx(0.92)
        assert grade.flagged_uncertain is False
        assert "Well explained" in grade.feedback

    async def test_returns_incorrect_grade_from_llm(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={
            "is_correct": False,
            "feedback": "Missing ACID definition.",
            "flagged_uncertain": False,
            "confidence": 0.15,
        })
        grade = await svc.grade_frq_answer(SAMPLE_NOTES, "q", "expected", "wrong")
        assert grade.is_correct is False

    async def test_uses_keyword_fallback_on_llm_error(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(side_effect=Exception("LLM unreachable"))
        grade = await svc.grade_frq_answer(SAMPLE_NOTES, "q", "atomicity durability transaction", "atomicity durability transaction")
        assert grade.flagged_uncertain is True

    async def test_confidence_always_clamped_0_to_1(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={
            "is_correct": True, "feedback": "ok",
            "flagged_uncertain": False, "confidence": 99.9,
        })
        grade = await svc.grade_frq_answer(SAMPLE_NOTES, "q", "e", "u")
        assert 0.0 <= grade.confidence <= 1.0


# ── generate_flashcards ────────────────────────────────────────────────────────

class TestGenerateFlashcards:

    async def test_returns_correct_cards_from_llm(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={
            "flashcards": [
                {"front": "What is Atomicity?", "back": "All-or-nothing execution."},
                {"front": "What is Durability?", "back": "Committed data persists."},
            ]
        })
        cards = await svc.generate_flashcards(SAMPLE_NOTES, count=2)
        assert len(cards) == 2
        assert all(isinstance(c, GeneratedFlashcard) for c in cards)
        assert cards[0].front == "What is Atomicity?"
        assert cards[1].back == "Committed data persists."

    async def test_caps_output_at_requested_count(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={
            "flashcards": [{"front": f"Q{i}", "back": f"A{i}"} for i in range(10)]
        })
        cards = await svc.generate_flashcards(SAMPLE_NOTES, count=3)
        assert len(cards) == 3

    async def test_falls_back_on_llm_error(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(side_effect=Exception("Groq down"))
        cards = await svc.generate_flashcards(SAMPLE_NOTES, count=2)
        assert len(cards) == 2
        assert all(isinstance(c, GeneratedFlashcard) for c in cards)

    async def test_falls_back_on_malformed_response(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"flashcards": "not a list"})
        cards = await svc.generate_flashcards(SAMPLE_NOTES, count=2)
        assert len(cards) == 2
