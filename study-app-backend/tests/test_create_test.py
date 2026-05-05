"""
Unit tests for the test creation pipeline.

Covers:
- LLMService.parse_practice_test(): count limiting, count=0 filtering,
  type filtering, malformed LLM responses, empty results
- TestService.create_test(): regular notes path, practice-test-file path,
  validation errors, question storage
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.llm_service import (
    GeneratedFRQ,
    GeneratedMCQ,
    LLMService,
)

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

class TestParsePracticeTest:

    async def test_returns_mcq_and_frq_from_llm(self):
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ], "frq": [VALID_FRQ]})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(mcq) == 1
        assert len(frq) == 1
        assert isinstance(mcq[0], GeneratedMCQ)
        assert isinstance(frq[0], GeneratedFRQ)

    async def test_limits_mcq_when_count_mcq_specified(self):
        """count_mcq=2 with 5 questions returned → only 2 kept."""
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ] * 5, "frq": []})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, count_mcq=2)
        assert len(mcq) == 2
        assert len(frq) == 0

    async def test_limits_frq_when_count_frq_specified(self):
        """count_frq=1 with 4 FRQ returned → only 1 kept."""
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [], "frq": [VALID_FRQ] * 4})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, count_frq=1)
        assert len(mcq) == 0
        assert len(frq) == 1

    async def test_count_mcq_zero_filters_out_all_mcq(self):
        """
        REGRESSION: count_mcq=0 must produce zero MCQ even if the LLM found some.
        This happens in MCQ_only mode where count_frq is forced to 0 — symmetrically,
        FRQ_only mode forces count_mcq to 0.
        Previously the guard `if count_mcq > 0:` skipped the slice, returning all items.
        """
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ] * 3, "frq": [VALID_FRQ]})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, count_mcq=0, count_frq=1)
        assert len(mcq) == 0, "count_mcq=0 must return zero MCQ (FRQ_only path)"
        assert len(frq) == 1

    async def test_count_frq_zero_filters_out_all_frq(self):
        """
        REGRESSION: count_frq=0 must produce zero FRQ even if the LLM found some.
        This happens in MCQ_only mode.
        """
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ], "frq": [VALID_FRQ] * 3})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, count_mcq=1, count_frq=0)
        assert len(frq) == 0, "count_frq=0 must return zero FRQ (MCQ_only path)"
        assert len(mcq) == 1

    async def test_both_counts_zero_returns_all_found(self):
        """Default call (count_mcq=0, count_frq=0) should return everything found."""
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [VALID_MCQ] * 3, "frq": [VALID_FRQ] * 2})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(mcq) == 3
        assert len(frq) == 2

    async def test_filters_invalid_mcq_items(self):
        """MCQ items failing _is_valid_mcq are dropped."""
        invalid = {"question_text": "Which statement is supported by the notes? (1)", "options": ["A", "B", "C", "D"], "correct_index": 0}
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [invalid, VALID_MCQ], "frq": []})
        mcq, _ = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(mcq) == 1
        assert VALID_MCQ["question_text"] in mcq[0].question_text

    async def test_filters_invalid_frq_items(self):
        """FRQ items with empty answer are dropped."""
        invalid = {"question_text": "Some question?", "expected_answer": ""}
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [], "frq": [invalid, VALID_FRQ]})
        _, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(frq) == 1

    async def test_returns_empty_on_llm_exception(self):
        """If LLM call fails, returns ([], []) rather than raising."""
        svc = LLMService()
        svc._complete_json = AsyncMock(side_effect=Exception("Groq timeout"))
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST, count_mcq=5, count_frq=3)
        assert mcq == []
        assert frq == []

    async def test_returns_empty_on_malformed_llm_json(self):
        """If LLM returns unexpected structure, returns ([], []) gracefully."""
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"wrong_key": "oops"})
        mcq, frq = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert mcq == []
        assert frq == []

    async def test_correct_index_clamped_to_valid_range(self):
        """correct_index out of bounds (e.g. 99) is clamped to [0, 3]."""
        bad_index = {**VALID_MCQ, "correct_index": 99}
        svc = LLMService()
        svc._complete_json = AsyncMock(return_value={"mcq": [bad_index], "frq": []})
        mcq, _ = await svc.parse_practice_test(SAMPLE_PRACTICE_TEST)
        assert len(mcq) == 1
        assert mcq[0].correct_index == 3  # clamped to max 3

    async def test_metadata_stripped_before_sending_to_llm(self):
        """Document markers are stripped before sending to LLM."""
        content_with_meta = (
            "[practice_test.md]\n--- Document 1: practice_test.md ---\n"
            "---\ntitle: Test\n---\n" + SAMPLE_PRACTICE_TEST
        )
        svc = LLMService()
        captured: list[str] = []

        async def capture(prompt: str, provider=None) -> dict:
            captured.append(prompt)
            return {"mcq": [VALID_MCQ], "frq": [VALID_FRQ]}

        svc._complete_json = capture  # type: ignore[method-assign]
        await svc.parse_practice_test(content_with_meta)

        assert len(captured) == 1
        assert "Document 1:" not in captured[0]
        assert "title: Test" not in captured[0]


# ── TestService.create_test — service-layer unit tests ─────────────────────────

class TestCreateTestService:
    """
    Tests for TestService.create_test() with all external dependencies mocked.
    Verifies routing logic (notes vs practice-test path), question storage,
    and validation error handling.
    """

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
        assert call_kwargs["count_mcq"] == 20
        assert call_kwargs["count_frq"] == 8
        assert result.questions_generated == 28

    async def test_practice_test_mcq_only_passes_zero_frq_count(self):
        """
        With test_type='MCQ_only' and a practice test file, parse_practice_test
        must be called with count_frq=0 so no FRQ questions are stored.
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
        assert call_kwargs["count_frq"] == 0, "MCQ_only must set count_frq=0 for parse_practice_test"

    async def test_practice_test_frq_only_passes_zero_mcq_count(self):
        """
        With test_type='FRQ_only' and a practice test file, parse_practice_test
        must be called with count_mcq=0 so no MCQ questions are stored.
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
        assert call_kwargs["count_mcq"] == 0, "FRQ_only must set count_mcq=0 for parse_practice_test"

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
