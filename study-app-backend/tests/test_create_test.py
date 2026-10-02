"""
Unit tests for the test creation pipeline.

Covers:
- LLMService.parse_practice_test(): recreate mode keeps every question,
  type filtering, 2-6 options, chunking, dedup, and failing loudly
- TestService.create_test(): regular notes path, practice-test-file path,
  validation errors, question storage
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.mcq_verification_service import inflated_mcq_count
from src.services.llm_service import (
    _PRACTICE_CHUNK_CHARS,
    GeneratedFRQ,
    GeneratedMCQ,
    LLMService,
)
from src.utils.exceptions import LLMException, ValidationException

# ── shared fixtures ────────────────────────────────────────────────────────────

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

SAMPLE_PRACTICE_TEST = (
    "Practice Test — Database Systems\n\n"
    "1. What does Atomicity guarantee?\n"
    "   A) All operations complete or none do\n"
    "   B) Transactions execute in sequence\n"
    "   C) Data is replicated to multiple nodes\n"
    "   D) Queries run faster with indexes\n"
    "   Answer: A\n\n"
    "2. Explain Durability in the context of ACID.\n"
    "   Model Answer: Committed data persists even after a system crash.\n"
)


# ── parse_practice_test ────────────────────────────────────────────────────────

def _mcq(n: int, **overrides) -> dict:
    return {**VALID_MCQ, "question_text": f"Question {n}: what does Atomicity guarantee?", **overrides}


def _frq(n: int, **overrides) -> dict:
    return {**VALID_FRQ, "question_text": f"Question {n}: explain Durability.", **overrides}


class TestParsePracticeTest:

    async def test_returns_mcq_and_frq_from_llm(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ], "frq": [VALID_FRQ]})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(mcq) == 1
        assert len(frq) == 1
        assert isinstance(mcq[0], GeneratedMCQ)
        assert isinstance(frq[0], GeneratedFRQ)

    async def test_keeps_every_question_with_no_count_cap(self):
        """Recreate mode: a 30-question test comes back with 30 questions."""
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={
            "mcq": [_mcq(i) for i in range(25)], "frq": [_frq(i) for i in range(5)],
        })
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert (len(mcq), len(frq)) == (25, 5)

    async def test_include_mcq_false_drops_mcq(self):
        """FRQ_only keeps only the written questions."""
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [_mcq(1), _mcq(2)], "frq": [VALID_FRQ]})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, include_mcq=False)
        assert mcq == []
        assert len(frq) == 1

    async def test_include_frq_false_drops_frq(self):
        """MCQ_only keeps only the multiple choice questions."""
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ], "frq": [_frq(1), _frq(2)]})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, include_frq=False)
        assert len(mcq) == 1
        assert frq == []

    async def test_true_false_and_five_option_questions_are_kept(self):
        svc = LLMService()
        true_false = {"question_text": "Atomicity is part of ACID.", "options": ["True", "False"], "correct_index": 0}
        five = {
            "question_text": "Which is not an ACID property?",
            "options": ["Atomicity", "Consistency", "Isolation", "Durability", "Scalability"],
            "correct_index": "E",
        }
        svc._complete_json = AsyncMock(return_value={"mcq": [true_false, five], "frq": []})
        mcq, _ = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert [q.options for q in mcq] == [true_false["options"], five["options"]]
        assert [q.correct_index for q in mcq] == [0, 4]

    async def test_letter_labels_are_stripped_from_options(self):
        svc = LLMService()
        labeled = _mcq(1, options=["A. one", "B. two", "(C) three", "d) four"])
        svc._complete_json = AsyncMock(return_value={"mcq": [labeled], "frq": []})
        mcq, _ = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert mcq[0].options == ["one", "two", "three", "four"]

    async def test_seven_options_or_an_empty_option_is_rejected(self):
        svc = LLMService()
        too_many = _mcq(1, options=[str(i) for i in range(7)])
        blank = _mcq(2, options=["a", "", "c", "d"])
        svc._complete_json = AsyncMock(return_value={"mcq": [too_many, blank, VALID_MCQ], "frq": []})
        mcq, _ = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert [q.question_text for q in mcq] == [VALID_MCQ["question_text"]]

    async def test_filters_invalid_frq_items(self):
        """FRQ items with empty answer are dropped."""
        invalid = {"question_text": "Some question?", "expected_answer": ""}
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [], "frq": [invalid, VALID_FRQ]})
        _, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(frq) == 1

    async def test_correct_index_out_of_range_is_rejected_not_clamped(self):
        """correct_index out of bounds (e.g. 99) is rejected, not silently
        clamped into a confidently wrong answer key (MCQ verification hardening).
        """
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [_mcq(1, correct_index=99), VALID_MCQ], "frq": []})
        mcq, _ = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(mcq) == 1

    async def test_llm_failure_raises_instead_of_an_empty_test(self):
        """REGRESSION: a failed parse used to return ([], []), so the test went
        "ready" with zero questions and no error."""
        svc = LLMService()
        svc._complete_json = AsyncMock(side_effect=Exception("Groq timeout"))
        with pytest.raises(LLMException):
            await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)

    async def test_no_questions_found_raises_with_a_reason(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"wrong_key": "oops"})
        with pytest.raises(ValidationException, match="No questions were found"):
            await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)

    async def test_only_filtered_out_questions_names_the_test_type(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ], "frq": []})
        with pytest.raises(ValidationException, match="type you picked"):
            await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, include_mcq=False)

    async def test_empty_document_raises_without_an_llm_call(self):
        svc = LLMService()
        svc._complete_json = AsyncMock()
        with pytest.raises(ValidationException):
            await svc.parse_practice_test("  \n\n ")
        svc._complete_json.assert_not_awaited()

    async def test_repeated_option_lines_reach_the_llm(self):
        """REGRESSION: _strip_metadata dropped any short line repeated 4+ times,
        which deleted the True/False options of every question, and everything
        between two --- lines."""
        doc = "\n".join(f"{i}. Statement {i} is correct.\nTrue\nFalse\n---" for i in range(1, 7))
        svc = LLMService()
        captured: list[str] = []

        async def capture(prompt: str, provider=None) -> dict:
            captured.append(prompt)
            return {"mcq": [VALID_MCQ], "frq": []}

        svc._complete_json = capture  # type: ignore[method-assign]
        await svc.parse_practice_test(doc)
        assert captured[0].count("\nTrue\nFalse") == 6
        assert "Statement 3 is correct." in captured[0]

    async def test_document_markers_are_removed(self):
        content = "--- Document 1: practice_test.md ---\n" + SAMPLE_PRACTICE_TEST
        svc = LLMService()
        captured: list[str] = []

        async def capture(prompt: str, provider=None) -> dict:
            captured.append(prompt)
            return {"mcq": [VALID_MCQ], "frq": [VALID_FRQ]}

        svc._complete_json = capture  # type: ignore[method-assign]
        await svc.parse_practice_test(content)
        assert "Document 1:" not in captured[0]
        assert "1. What does Atomicity guarantee?" in captured[0]

    async def test_long_test_is_read_in_chunks_with_the_answer_key(self):
        """A document past one chunk is read whole: every part gets its own
        call, and each call sees the answer key from the end."""
        body = "\n\n".join(f"{i}. Question {i}?\nA. w\nB. x\nC. y\nD. z" for i in range(1, 900))
        doc = body + "\n\nAnswer Key\n1. B\n2. C\n"
        assert len(doc) > 2 * _PRACTICE_CHUNK_CHARS
        svc = LLMService()
        prompts: list[str] = []

        async def capture(prompt: str, provider=None) -> dict:
            prompts.append(prompt)
            # Every part re-reports the overlap question; it must be kept once.
            return {"mcq": [_mcq(len(prompts)), VALID_MCQ], "frq": []}

        svc._complete_json = capture  # type: ignore[method-assign]
        mcq, _ = await svc.parse_practice_test(doc)
        assert len(prompts) >= 3
        assert all("ANSWER KEY FROM THE END" in p and "1. B" in p for p in prompts)
        assert "899. Question 899?" in prompts[-1]
        assert len(mcq) == len(prompts) + 1

    async def test_one_failed_chunk_keeps_the_rest(self):
        body = "\n\n".join(f"{i}. Question {i}?\nA. w\nB. x\nC. y\nD. z" for i in range(1, 900))
        svc = LLMService()
        calls = 0

        async def flaky(prompt: str, provider=None) -> dict:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("rate limited")
            return {"mcq": [_mcq(calls)], "frq": []}

        svc._complete_json = flaky  # type: ignore[method-assign]
        mcq, _ = await svc.parse_practice_test(body)
        assert len(mcq) == calls - 1


class TestParsePracticeTestAccuracy:
    """GH #133: found with a real 236-page homework PDF."""

    async def test_table_of_contents_never_reaches_the_llm(self):
        doc = (
            "Contents\n"
            "1.1 Vector equations . . . . . . . . . . . . . 7\n"
            "1.2 Vector notation . . . . . . . . . . . . . . 8\n\n"
            "1.1 Vector equations\nDetermine whether (1, 2) = (1, 2) is true.\n"
        )
        svc = LLMService()
        prompts: list[str] = []

        async def capture(prompt: str, provider=None) -> dict:
            prompts.append(prompt)
            return {"mcq": [], "frq": [VALID_FRQ]}

        svc._complete_json = capture  # type: ignore[method-assign]
        await svc.parse_practice_test(doc)
        assert ". . . . ." not in prompts[0]
        assert "Determine whether (1, 2) = (1, 2) is true." in prompts[0]

    async def test_heading_only_questions_with_non_answers_are_dropped(self):
        junk = {"question_text": "1.1 Vector equations", "expected_answer": "Depends on the specific problem statement in the textbook."}
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [], "frq": [junk, VALID_FRQ]})
        _, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert [q.question_text for q in frq] == [VALID_FRQ["question_text"]]

    async def test_dedup_ignores_leftover_emphasis_markers(self):
        plain = _mcq(1, question_text="Assuming the matrix K makes sense, which is true?")
        marked = _mcq(1, question_text="Assuming the matrix _K_ makes sense, which is true?")
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [plain, marked], "frq": []})
        mcq, _ = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(mcq) == 1

    async def test_keyless_questions_are_solved_by_the_strongest_provider_and_flagged(self):
        keyed = _mcq(1, answer_from_document=True)
        keyless_mcq = _mcq(2, correct_index=3, answer_from_document=False)
        keyless_frq = _frq(1, expected_answer="a weak guess", answer_from_document=False)
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [keyed, keyless_mcq], "frq": [keyless_frq]})
        solve_prompts: list[str] = []

        async def strongest(prompt: str) -> dict:
            solve_prompts.append(prompt)
            return {"answers": [{"q": 1, "option": 0}, {"q": 2, "answer": "the solved answer"}]}

        svc._complete_json_strongest = strongest  # type: ignore[method-assign]
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)

        assert len(solve_prompts) == 1
        assert [q.answer_inferred for q in mcq] == [False, True]
        assert mcq[1].correct_index == 0
        assert frq[0].answer_inferred is True
        assert frq[0].expected_answer == "the solved answer"

    async def test_the_solver_sees_the_course_notes_for_conventions(self):
        keyless = _frq(1, answer_from_document=False)
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [], "frq": [keyless]})
        svc._retrieve_relevant_context = lambda notes, query, **kw: ("We write (1, 2, 1) for a column vector.", {})  # type: ignore[method-assign]
        prompts: list[str] = []

        async def strongest(prompt: str) -> dict:
            prompts.append(prompt)
            return {"answers": []}

        svc._complete_json_strongest = strongest  # type: ignore[method-assign]
        await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, solve_context="textbook chapter 1")
        assert "COURSE NOTES" in prompts[0]
        assert "(1, 2, 1) for a column vector" in prompts[0]

    async def test_a_failed_solve_keeps_the_parse_answer(self):
        keyless = _frq(1, expected_answer="parse guess", answer_from_document=False)
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [], "frq": [keyless]})
        svc._complete_json_strongest = AsyncMock(side_effect=RuntimeError("all providers down"))  # type: ignore[method-assign]
        _, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert frq[0].expected_answer == "parse guess"
        assert frq[0].answer_inferred is True

    async def test_a_hung_chunk_is_retried_off_ollama(self, monkeypatch):
        import src.services.llm_service as llm_module

        monkeypatch.setattr(llm_module, "_PRACTICE_CHUNK_TIMEOUT_S", 0.05)
        svc = LLMService()

        async def hang(prompt: str, provider=None) -> dict:
            await asyncio.sleep(5)
            return {}

        svc._complete_json = hang  # type: ignore[method-assign]
        svc._complete_json_skip_ollama = AsyncMock(return_value={"mcq": [VALID_MCQ], "frq": []})  # type: ignore[method-assign]
        mcq, _ = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(mcq) == 1
        svc._complete_json_skip_ollama.assert_awaited_once()


class TestParallelPracticeTest:
    """"Match its style" writes one new question per original (GH #133)."""

    def _service(self, originals_mcq, originals_frq, reply):
        svc = LLMService()
        svc.parse_practice_test = AsyncMock(return_value=(originals_mcq, originals_frq))  # type: ignore[method-assign]
        svc._complete_json_strongest = AsyncMock(return_value={"answers": []})  # type: ignore[method-assign]
        prompts: list[str] = []

        async def complete(prompt: str, provider=None) -> dict:
            prompts.append(prompt)
            return reply(prompt) if callable(reply) else reply

        svc._complete_json = complete  # type: ignore[method-assign]
        return svc, prompts

    async def test_each_original_gets_one_counterpart_of_the_same_type(self):
        originals = [GeneratedMCQ("Which gas is fastest at 25 C?", ["He", "N2", "CO2"], 0)]
        written = [GeneratedFRQ("Explain hydrogen bonding in water.", "...")]
        reply = {"questions": [
            {"original": 1, "question_text": "Which gas is slowest at 25 C?", "options": ["He", "N2", "SF6"], "correct_index": 2},
            {"original": 2, "question_text": "Explain why ice floats.", "expected_answer": "Hydrogen bonds hold an open lattice."},
        ]}
        svc, prompts = self._service(originals, written, reply)

        mcq, frq = await svc.generate_parallel_practice_test("exam text")

        assert [q.question_text for q in mcq] == ["Which gas is slowest at 25 C?"]
        assert mcq[0].options == ["He", "N2", "SF6"] and mcq[0].correct_index == 2
        assert [q.question_text for q in frq] == ["Explain why ice floats."]
        # Twins have no answer key: solved by the strongest provider and flagged.
        assert all(q.answer_inferred for q in [*mcq, *frq])
        svc._complete_json_strongest.assert_awaited_once()
        assert "Which gas is fastest at 25 C?" in prompts[0]
        assert "multiple choice, 3 options" in prompts[0]
        svc.parse_practice_test.assert_awaited_once()
        assert svc.parse_practice_test.call_args.kwargs["solve_keyless"] is False

    async def test_notes_are_optional_and_only_sent_when_present(self):
        originals = [GeneratedFRQ("Explain osmosis.", "...")]
        reply = {"questions": [{"original": 1, "question_text": "Explain diffusion.", "expected_answer": "Net movement..."}]}
        svc, prompts = self._service([], originals, reply)
        await svc.generate_parallel_practice_test("exam text", notes="")
        assert "STUDY NOTES" not in prompts[0]

    async def test_a_failed_batch_keeps_the_others(self, monkeypatch):
        import src.services.llm_service as llm_module

        monkeypatch.setattr(llm_module, "_PARALLEL_BATCH", 1)
        originals = [GeneratedFRQ(f"Original {i}?", "...") for i in range(3)]

        def reply(prompt: str) -> dict:
            if "Original 1?" in prompt:
                raise RuntimeError("provider down")
            n = 0 if "Original 0?" in prompt else 2
            return {"questions": [{"original": 1, "question_text": f"New {n}?", "expected_answer": "x"}]}

        svc, _ = self._service([], originals, reply)
        _, frq = await svc.generate_parallel_practice_test("exam text")
        assert [q.question_text for q in frq] == ["New 0?", "New 2?"]

    async def test_nothing_written_raises(self):
        svc, _ = self._service([], [GeneratedFRQ("Original?", "...")], {"questions": []})
        with pytest.raises(LLMException):
            await svc.generate_parallel_practice_test("exam text")


# ── TestService.create_test — service-layer unit tests ─────────────────────────

class TestCreateTestService:
    """
    Tests for TestService.create_test() with all external dependencies mocked.
    Verifies routing logic (notes vs practice-test path), question storage,
    and validation error handling.

    MCQ verification is disabled for every test in this class: create_test()
    instantiates its own MCQVerificationService (and, inside that, its own
    LLMService) rather than reusing the mocked svc.llm_service, so an enabled
    verifier here would make a real provider-candidate check per test. That
    behavior (derive/adjudicate calls, the decision table, the veto matcher)
    is exhaustively covered in test_mcq_verification.py; disabling it here
    also exercises the MCQ_VERIFICATION_ENABLED=false full-bypass row of the
    fail-open matrix for free.
    """

    @pytest.fixture(autouse=True)
    def _disable_mcq_verification(self, monkeypatch):
        monkeypatch.setattr("src.services.test_service.settings.mcq_verification_enabled", False)

    def _make_upload_file(self, name: str = "notes.txt", content: bytes = b"Study content.") -> MagicMock:
        f = MagicMock()
        f.filename = name
        f.read = AsyncMock(return_value=content)
        f.seek = AsyncMock()
        return f

    def _make_service(
        self,
        llm_mcq: list[GeneratedMCQ] | None = None,
        llm_frq: list[GeneratedFRQ] | None = None,
        parse_mcq: list[GeneratedMCQ] | None = None,
        parse_frq: list[GeneratedFRQ] | None = None,
    ):
        from src.services.test_service import TestService

        svc = TestService()

        # LLM service mocks
        svc.llm_service = MagicMock()
        svc.llm_service.generate_test_questions = AsyncMock(return_value=(
            llm_mcq or [GeneratedMCQ("Q1", ["A", "B", "C", "D"], 0)],
            llm_frq or [GeneratedFRQ("FQ1", "Answer 1")],
        ))
        svc.llm_service.parse_practice_test = AsyncMock(return_value=(
            parse_mcq or [GeneratedMCQ("PQ1", ["A", "B", "C", "D"], 0)],
            parse_frq or [GeneratedFRQ("PFQ1", "Answer")],
        ))
        svc.llm_service.generate_from_practice_test_template = AsyncMock(return_value=(
            llm_mcq or [GeneratedMCQ("Q1", ["A", "B", "C", "D"], 0)],
            llm_frq or [GeneratedFRQ("FQ1", "Answer 1")],
        ))

        # File service mock
        svc.file_service = MagicMock()
        svc.file_service.extract_from_files = AsyncMock(return_value=("Extracted content", ["txt"]))
        svc.file_service.extract_from_file = AsyncMock(return_value=("Practice test content", "txt"))
        svc.file_service.get_folder_files_content = AsyncMock(return_value="")

        return svc

    def _make_session_and_repo(self, folder_exists: bool = True):
        """Build a mock AsyncSession and mock the two repositories."""
        session = AsyncMock()
        session.commit = AsyncMock()
        session.flush = AsyncMock()

        # Fake folder for ownership check
        fake_folder = MagicMock()
        fake_folder.id = 1

        # Fake test record
        fake_test = MagicMock()
        fake_test.id = 42
        fake_test.title = "Test Title"

        # Fake question
        fake_question = MagicMock()
        fake_question.id = 100

        folder_repo_mock = MagicMock()
        folder_repo_mock.get_owned = AsyncMock(return_value=fake_folder if folder_exists else None)

        test_repo_mock = MagicMock()
        test_repo_mock.create = AsyncMock(return_value=fake_test)
        test_repo_mock.add_note = AsyncMock()
        test_repo_mock.add_mcq_question = AsyncMock(return_value=fake_question)
        test_repo_mock.add_frq_question = AsyncMock(return_value=fake_question)

        return session, folder_repo_mock, test_repo_mock

    async def test_regular_path_calls_generate_test_questions(self):
        """When no practice_test_file is given, must use llm.generate_test_questions."""
        svc = self._make_service()
        session, folder_repo, test_repo = self._make_session_and_repo()

        notes_file = self._make_upload_file()

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            result = await svc.create_test(
                folder_id=1,
                user_id=1,
                title="My Test",
                test_type="mixed",
                notes_files=[notes_file],
                session=session,
            )

        svc.llm_service.generate_test_questions.assert_awaited_once()
        svc.llm_service.parse_practice_test.assert_not_awaited()
        assert result.test_id == 42
        assert result.questions_generated == 2

    async def test_practice_test_path_calls_parse_practice_test(self):
        """When practice_test_file is given, must use llm.parse_practice_test."""
        svc = self._make_service()
        session, folder_repo, test_repo = self._make_session_and_repo()

        practice_file = self._make_upload_file("exam.pdf")

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            result = await svc.create_test(
                folder_id=1,
                user_id=1,
                title="My Test",
                test_type="mixed",
                notes_files=[],
                session=session,
                practice_test_file=practice_file,
            )

        svc.llm_service.parse_practice_test.assert_awaited_once()
        svc.llm_service.generate_test_questions.assert_not_awaited()
        assert result.test_id == 42

    async def test_advanced_mode_count_params_passed_to_generate(self):
        """count_mcq=20 / count_frq=8 must be forwarded to generate_test_questions."""
        svc = self._make_service(
            llm_mcq=[GeneratedMCQ(f"Q{i}", ["A", "B", "C", "D"], 0) for i in range(20)],
            llm_frq=[GeneratedFRQ(f"FQ{i}", "ans") for i in range(8)],
        )
        session, folder_repo, test_repo = self._make_session_and_repo()

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            result = await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="mixed",
                notes_files=[self._make_upload_file()],
                session=session,
                count_mcq=20,
                count_frq=8,
            )

        call_kwargs = svc.llm_service.generate_test_questions.call_args.kwargs
        # count_mcq is inflated before generation (MCQ verification over-generation,
        # see mcq_verification_service.inflated_mcq_count); the raw request (20) is
        # what verification later trims back down to, not what generation receives.
        assert call_kwargs["count_mcq"] == inflated_mcq_count(20)
        assert call_kwargs["count_frq"] == 8
        assert result.questions_generated == 28

    async def test_practice_test_mcq_only_drops_frq(self):
        """
        With test_type='MCQ_only' and a practice test file, parse_practice_test
        must be told to drop FRQ so no FRQ questions are stored.
        """
        svc = self._make_service(parse_mcq=[GeneratedMCQ("PQ1", ["A", "B", "C", "D"], 0)], parse_frq=[])
        session, folder_repo, test_repo = self._make_session_and_repo()

        practice_file = self._make_upload_file("exam.txt")

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="MCQ_only",
                notes_files=[], session=session,
                practice_test_file=practice_file,
                count_mcq=5,
            )

        call_kwargs = svc.llm_service.parse_practice_test.call_args.kwargs
        assert call_kwargs["include_frq"] is False, "MCQ_only must drop FRQ in parse_practice_test"
        assert call_kwargs["include_mcq"] is True

    async def test_practice_test_frq_only_drops_mcq(self):
        """
        With test_type='FRQ_only' and a practice test file, parse_practice_test
        must be told to drop MCQ so no MCQ questions are stored.
        """
        svc = self._make_service(parse_mcq=[], parse_frq=[GeneratedFRQ("PFQ1", "ans")])
        session, folder_repo, test_repo = self._make_session_and_repo()

        practice_file = self._make_upload_file("exam.txt")

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="FRQ_only",
                notes_files=[], session=session,
                practice_test_file=practice_file,
                count_frq=3,
            )

        call_kwargs = svc.llm_service.parse_practice_test.call_args.kwargs
        assert call_kwargs["include_mcq"] is False, "FRQ_only must drop MCQ in parse_practice_test"
        assert call_kwargs["include_frq"] is True

    async def test_notes_file_stored_as_note_record(self):
        """A notes file must be persisted as a Note record via add_note."""
        svc = self._make_service(llm_mcq=[], llm_frq=[])
        session, folder_repo, test_repo = self._make_session_and_repo()

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="mixed",
                notes_files=[self._make_upload_file("notes.txt")],
                session=session,
            )

        test_repo.add_note.assert_awaited_once()

    async def test_raises_resource_not_found_when_folder_missing(self):
        """If the folder doesn't belong to the user, raise ResourceNotFoundException."""
        from src.utils.exceptions import ResourceNotFoundException

        svc = self._make_service()
        session, folder_repo, test_repo = self._make_session_and_repo(folder_exists=False)

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
            pytest.raises(ResourceNotFoundException),
        ):
            await svc.create_test(
                folder_id=99, user_id=1, title="T", test_type="mixed",
                notes_files=[self._make_upload_file()],
                session=session,
            )

    async def test_raises_validation_error_on_invalid_test_type(self):
        """An unrecognised test_type must raise ValidationException immediately."""
        from src.utils.exceptions import ValidationException

        svc = self._make_service()
        session, folder_repo, test_repo = self._make_session_and_repo()

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
            pytest.raises(ValidationException),
        ):
            await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="invalid_type",
                notes_files=[self._make_upload_file()],
                session=session,
            )

    async def test_raises_validation_error_when_no_files_and_no_practice_file(self):
        """Must raise ValidationException if both notes_files and practice_test_file are absent."""
        from src.utils.exceptions import ValidationException

        svc = self._make_service()
        session, folder_repo, test_repo = self._make_session_and_repo()

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
            pytest.raises(ValidationException),
        ):
            await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="mixed",
                notes_files=[],  # no notes
                session=session,
                practice_test_file=None,  # no practice file
            )

    async def test_practice_test_plus_notes_stores_two_note_records(self):
        """
        When a practice test file AND notes_files are both provided,
        two Note records must be stored (one for the practice file, one for notes).
        """
        svc = self._make_service(parse_mcq=[GeneratedMCQ("PQ1", ["A", "B", "C", "D"], 0)], parse_frq=[])
        session, folder_repo, test_repo = self._make_session_and_repo()

        practice_file = self._make_upload_file("exam.txt")
        notes_file = self._make_upload_file("lecture.txt")

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="MCQ_only",
                notes_files=[notes_file],
                session=session,
                practice_test_file=practice_file,
            )

        assert test_repo.add_note.await_count == 2, (
            "Both the practice test file and the notes file must be stored as Note records"
        )

    async def test_math_mode_flag_forwarded_to_llm(self):
        """is_math_mode=True must be forwarded to generate_test_questions."""
        svc = self._make_service()
        session, folder_repo, test_repo = self._make_session_and_repo()

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="mixed",
                notes_files=[self._make_upload_file()],
                session=session,
                is_math_mode=True,
            )

        call_kwargs = svc.llm_service.generate_test_questions.call_args.kwargs
        assert call_kwargs["is_math_mode"] is True

    async def test_questions_generated_count_matches_stored_questions(self):
        """questions_generated in the response must equal the total MCQ + FRQ count."""
        mcq_list = [GeneratedMCQ(f"Q{i}", ["A", "B", "C", "D"], 0) for i in range(7)]
        frq_list = [GeneratedFRQ(f"FQ{i}", "ans") for i in range(3)]
        svc = self._make_service(llm_mcq=mcq_list, llm_frq=frq_list)
        session, folder_repo, test_repo = self._make_session_and_repo()

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
        ):
            result = await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="mixed",
                notes_files=[self._make_upload_file()],
                session=session,
            )

        assert result.questions_generated == 10
        assert test_repo.add_mcq_question.await_count == 7
        assert test_repo.add_frq_question.await_count == 3


class TestCreateTestMcqVerificationWiring:
    """MCQ verification IS enabled here (unlike TestCreateTestService, which
    disables it to stay fast/focused). These tests prove create_test() wires
    MCQVerificationService in on the notes and practice-test-template paths,
    that its result replaces mcq_questions before persistence, and that the
    requested (not inflated) count is what generate_test_questions is asked to
    over-generate from.
    """

    def _make_upload_file(self, name: str = "notes.txt", content: bytes = b"Study content.") -> MagicMock:
        f = MagicMock()
        f.filename = name
        f.read = AsyncMock(return_value=content)
        f.seek = AsyncMock()
        return f

    def _make_service(self, llm_mcq: list[GeneratedMCQ]):
        from src.services.test_service import TestService

        svc = TestService()
        svc.llm_service = MagicMock()
        svc.llm_service.generate_test_questions = AsyncMock(return_value=(llm_mcq, []))
        svc.llm_service.generate_from_practice_test_template = AsyncMock(return_value=(llm_mcq, []))
        svc.llm_service.get_last_generation_meta = MagicMock(return_value={})
        svc.file_service = MagicMock()
        svc.file_service.extract_from_files = AsyncMock(return_value=("Extracted content", ["txt"]))
        svc.file_service.get_folder_files_content = AsyncMock(return_value="")
        return svc

    def _make_session_and_repo(self):
        session = AsyncMock()
        session.commit = AsyncMock()
        folder = MagicMock()
        folder_repo = MagicMock()
        folder_repo.get_owned = AsyncMock(return_value=folder)
        test = MagicMock()
        test.id = 42
        test.title = "T"
        test_repo = MagicMock()
        test_repo.create = AsyncMock(return_value=test)
        test_repo.add_note = AsyncMock()
        test_repo.add_mcq_question = AsyncMock()
        test_repo.add_frq_question = AsyncMock()
        return session, folder_repo, test_repo

    async def test_verifier_drop_removes_a_question_before_persistence(self, monkeypatch):
        monkeypatch.setattr("src.services.test_service.settings.mcq_verification_enabled", True)
        mcq_list = [GeneratedMCQ(f"Q{i}", ["A", "B", "C", "D"], 0) for i in range(3)]
        svc = self._make_service(llm_mcq=mcq_list)
        session, folder_repo, test_repo = self._make_session_and_repo()

        fake_verifier = MagicMock()
        # Verification drops Q1, keeping Q0 and Q2 — proves the returned list
        # (not the original generation output) is what gets persisted.
        fake_verifier.verify_generated_mcqs = AsyncMock(
            return_value=([mcq_list[0], mcq_list[2]], {"dropped": 1})
        )

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
            patch("src.services.test_service.MCQVerificationService", return_value=fake_verifier),
        ):
            result = await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="MCQ_only",
                notes_files=[self._make_upload_file()],
                session=session,
                count_mcq=3, count_frq=0,
            )

        fake_verifier.verify_generated_mcqs.assert_awaited_once()
        assert test_repo.add_mcq_question.await_count == 2
        assert result.questions_generated == 2

    async def test_generation_receives_inflated_count_not_the_request(self, monkeypatch):
        monkeypatch.setattr("src.services.test_service.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.services.test_service.settings.mcq_verification_overgen_ratio", 1.3)
        mcq_list = [GeneratedMCQ(f"Q{i}", ["A", "B", "C", "D"], 0) for i in range(13)]
        svc = self._make_service(llm_mcq=mcq_list)
        session, folder_repo, test_repo = self._make_session_and_repo()

        fake_verifier = MagicMock()
        fake_verifier.verify_generated_mcqs = AsyncMock(return_value=(mcq_list[:10], {}))

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
            patch("src.services.test_service.MCQVerificationService", return_value=fake_verifier),
        ):
            await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="MCQ_only",
                notes_files=[self._make_upload_file()],
                session=session,
                count_mcq=10, count_frq=0,
            )

        generate_kwargs = svc.llm_service.generate_test_questions.call_args.kwargs
        # 10 requested * 1.3 = 13, within the +5 over-generation cap.
        assert generate_kwargs["count_mcq"] == 13
        verify_kwargs = fake_verifier.verify_generated_mcqs.call_args.kwargs
        assert verify_kwargs["requested_count"] == 10

    async def test_bypass_flag_skips_verifier_entirely(self, monkeypatch):
        monkeypatch.setattr("src.services.test_service.settings.mcq_verification_enabled", False)
        mcq_list = [GeneratedMCQ(f"Q{i}", ["A", "B", "C", "D"], 0) for i in range(5)]
        svc = self._make_service(llm_mcq=mcq_list)
        session, folder_repo, test_repo = self._make_session_and_repo()

        with (
            patch("src.services.test_service.FolderRepository", return_value=folder_repo),
            patch("src.services.test_service.TestRepository", return_value=test_repo),
            patch("src.services.test_service.MCQVerificationService") as mock_verifier_cls,
        ):
            result = await svc.create_test(
                folder_id=1, user_id=1, title="T", test_type="MCQ_only",
                notes_files=[self._make_upload_file()],
                session=session,
                count_mcq=5, count_frq=0,
            )

        mock_verifier_cls.assert_not_called()
        generate_kwargs = svc.llm_service.generate_test_questions.call_args.kwargs
        assert generate_kwargs["count_mcq"] == 5  # unchanged, no inflation
        assert result.questions_generated == 5
