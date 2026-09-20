"""
Tests for learning module quiz answer explanations.

Two halves:

1. LLMService._parse_quiz_explanations. Deliberately lenient, unlike the
   lesson/quiz parsers: explanations sit on top of a quiz that already works,
   so a malformed entry degrades to an empty one rather than failing a module
   build. These tests pin that leniency, and pin the one thing it must NOT be
   lenient about (a misaligned option_explanations list, which would show a
   rationale against the wrong option).

2. The lazy backfill in submit_quiz_attempt. Grading is deterministic and
   already committed before any provider call, so the score must survive an
   LLM that raises, hangs, or returns nothing useful.

Uses the db_session_maker fixture from conftest.py; LLMService is mocked.
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from src.models.folder import Folder
from src.models.learning_module import LearningModule, LearningTrack
from src.models.user import User
from src.schemas.learning_module_schema import QuizAttemptRequest
from src.services.llm_service import LLMService


QUIZ = [
    {"question": "Q1?", "options": ["A", "B", "C", "D"], "correct_index": 0},
    {"question": "Q2?", "options": ["A", "B", "C"], "correct_index": 2},
]


def _explanation(index: int, option_count: int) -> dict:
    return {
        "index": index,
        "explanation": f"Because of reason {index}.",
        "option_explanations": [f"note {i}" for i in range(option_count)],
        "lesson_section": "## Section One",
    }


class TestParseQuizExplanations:

    def test_well_formed_response_is_kept_intact(self):
        parsed = LLMService._parse_quiz_explanations(
            [_explanation(0, 4), _explanation(1, 3)], QUIZ
        )
        assert len(parsed) == 2
        assert parsed[0]["explanation"] == "Because of reason 0."
        assert parsed[0]["option_explanations"] == ["note 0", "note 1", "note 2", "note 3"]
        assert parsed[1]["option_explanations"] == ["note 0", "note 1", "note 2"]
        assert parsed[0]["lesson_section"] == "## Section One"

    def test_result_is_always_quiz_length_and_index_aligned(self):
        # Only the second question explained: the first must still occupy slot 0
        # as an empty entry, so callers can zip without a length check.
        parsed = LLMService._parse_quiz_explanations([_explanation(1, 3)], QUIZ)
        assert len(parsed) == 2
        assert parsed[0] == {"explanation": "", "option_explanations": [], "lesson_section": ""}
        assert parsed[1]["explanation"] == "Because of reason 1."

    def test_explicit_index_wins_over_position(self):
        # A model that drops a question would otherwise shift every later
        # explanation onto the wrong question.
        parsed = LLMService._parse_quiz_explanations(
            [{"index": 1, "explanation": "for the second one", "option_explanations": []}], QUIZ
        )
        assert parsed[0]["explanation"] == ""
        assert parsed[1]["explanation"] == "for the second one"

    def test_missing_index_falls_back_to_position(self):
        parsed = LLMService._parse_quiz_explanations(
            [{"explanation": "first"}, {"explanation": "second"}], QUIZ
        )
        assert parsed[0]["explanation"] == "first"
        assert parsed[1]["explanation"] == "second"

    def test_garbage_entries_are_dropped_not_raised(self):
        parsed = LLMService._parse_quiz_explanations(
            ["not a dict", None, 42, {"index": 0, "explanation": "kept"}], QUIZ
        )
        assert parsed[0]["explanation"] == "kept"
        assert parsed[1]["explanation"] == ""

    def test_out_of_range_index_is_ignored(self):
        parsed = LLMService._parse_quiz_explanations(
            [{"index": 99, "explanation": "nowhere"}, {"index": -1, "explanation": "also nowhere"}],
            QUIZ,
        )
        assert all(entry["explanation"] == "" for entry in parsed)

    def test_non_list_response_yields_all_empty(self):
        for raw in ({"explanations": "oops"}, "text", None, 7):
            parsed = LLMService._parse_quiz_explanations(raw, QUIZ)
            assert len(parsed) == 2
            assert all(entry["explanation"] == "" for entry in parsed)

    def test_misaligned_option_explanations_are_discarded_wholesale(self):
        """The one place leniency would do harm.

        A short or long list would pair rationales with the wrong options, so
        the whole list is dropped while the headline explanation survives.
        """
        parsed = LLMService._parse_quiz_explanations(
            [{"index": 0, "explanation": "kept", "option_explanations": ["only", "two"]}], QUIZ
        )
        assert parsed[0]["explanation"] == "kept"
        assert parsed[0]["option_explanations"] == []

    def test_all_blank_option_explanations_are_discarded(self):
        parsed = LLMService._parse_quiz_explanations(
            [{"index": 0, "explanation": "kept", "option_explanations": ["", "  ", "", ""]}], QUIZ
        )
        assert parsed[0]["option_explanations"] == []

    def test_empty_quiz_yields_empty_list(self):
        assert LLMService._parse_quiz_explanations([_explanation(0, 4)], []) == []


async def _seed_module(session_maker, quiz: list[dict], lesson: str = "## Section One\n\nBody.") -> int:
    async with session_maker() as session:
        user = User(email="u@example.com", google_id="g1")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="F1")
        session.add(folder)
        await session.flush()
        track = LearningTrack(folder_id=folder.id, status="ready", module_count=1, format="article")
        session.add(track)
        await session.flush()
        module = LearningModule(
            track_id=track.id,
            order_index=0,
            title="Module 1",
            lesson_content=lesson,
            quiz_json=json.dumps(quiz),
        )
        session.add(module)
        await session.flush()
        await session.commit()
        return module.id, user.id


async def _submit(session_maker, module_id: int, user_id: int, answers: list[int]):
    from src.routes.learning_modules import submit_quiz_attempt

    async with session_maker() as session:
        user = await session.get(User, user_id)
        return await submit_quiz_attempt(
            module_id, QuizAttemptRequest(answers=answers), session=session, user=user
        )


@pytest.mark.asyncio
class TestQuizExplanationBackfill:

    async def test_score_returned_when_generation_raises(self, db_session_maker):
        """An LLM failure must cost the explanations, never the grade."""
        module_id, user_id = await _seed_module(db_session_maker, QUIZ)
        with patch.object(
            LLMService, "generate_quiz_explanations", AsyncMock(side_effect=RuntimeError("provider down"))
        ):
            result = await _submit(db_session_maker, module_id, user_id, [0, 2])

        assert result.score == 2
        assert result.total == 2
        assert result.passed is True
        assert result.correct_indices == [0, 2]
        assert all(e.explanation == "" for e in result.explanations)

    async def test_score_returned_when_generation_times_out(self, db_session_maker):
        module_id, user_id = await _seed_module(db_session_maker, QUIZ)

        async def _hang(*args, **kwargs):
            await asyncio.sleep(60)

        with patch("src.routes.learning_modules._EXPLANATION_BACKFILL_TIMEOUT_SECONDS", 0.05), \
             patch.object(LLMService, "generate_quiz_explanations", AsyncMock(side_effect=_hang)):
            result = await _submit(db_session_maker, module_id, user_id, [0, 0])

        assert result.score == 1
        assert result.correct_indices == [0, 2]
        assert all(e.explanation == "" for e in result.explanations)

    async def test_successful_backfill_is_returned_and_persisted(self, db_session_maker):
        """One call per legacy module: the merged quiz is written back."""
        module_id, user_id = await _seed_module(db_session_maker, QUIZ)
        generated = [
            {"explanation": "Because A.", "option_explanations": ["a", "b", "c", "d"], "lesson_section": "## Section One"},
            {"explanation": "Because C.", "option_explanations": ["a", "b", "c"], "lesson_section": ""},
        ]
        with patch.object(LLMService, "generate_quiz_explanations", AsyncMock(return_value=generated)):
            result = await _submit(db_session_maker, module_id, user_id, [0, 2])

        assert [e.explanation for e in result.explanations] == ["Because A.", "Because C."]
        assert result.explanations[0].option_explanations == ["a", "b", "c", "d"]
        assert result.explanations[0].lesson_section == "## Section One"

        async with db_session_maker() as session:
            stored = json.loads((await session.get(LearningModule, module_id)).quiz_json)
        assert stored[0]["explanation"] == "Because A."
        assert stored[1]["option_explanations"] == ["a", "b", "c"]

    async def test_no_generation_call_when_explanations_already_present(self, db_session_maker):
        quiz = [
            {**QUIZ[0], "explanation": "Already here.", "option_explanations": ["a", "b", "c", "d"], "lesson_section": ""},
            {**QUIZ[1], "explanation": "Also here.", "option_explanations": ["a", "b", "c"], "lesson_section": ""},
        ]
        module_id, user_id = await _seed_module(db_session_maker, quiz)
        generate = AsyncMock()
        with patch.object(LLMService, "generate_quiz_explanations", generate):
            result = await _submit(db_session_maker, module_id, user_id, [0, 2])

        generate.assert_not_awaited()
        assert [e.explanation for e in result.explanations] == ["Already here.", "Also here."]

    async def test_no_generation_call_without_a_lesson(self, db_session_maker):
        """Nothing to ground the explanations in, so do not spend the call."""
        module_id, user_id = await _seed_module(db_session_maker, QUIZ, lesson="")
        generate = AsyncMock()
        with patch.object(LLMService, "generate_quiz_explanations", generate):
            result = await _submit(db_session_maker, module_id, user_id, [0, 2])

        generate.assert_not_awaited()
        assert result.score == 2

    async def test_partial_backfill_keeps_the_questions_it_could_not_explain(self, db_session_maker):
        module_id, user_id = await _seed_module(db_session_maker, QUIZ)
        generated = [
            {"explanation": "", "option_explanations": [], "lesson_section": ""},
            {"explanation": "Because C.", "option_explanations": ["a", "b", "c"], "lesson_section": ""},
        ]
        with patch.object(LLMService, "generate_quiz_explanations", AsyncMock(return_value=generated)):
            result = await _submit(db_session_maker, module_id, user_id, [0, 2])

        assert result.explanations[0].explanation == ""
        assert result.explanations[1].explanation == "Because C."
        async with db_session_maker() as session:
            stored = json.loads((await session.get(LearningModule, module_id)).quiz_json)
        # The unexplained question keeps its original keys rather than gaining
        # empty ones, so a later retry still counts it as needing a backfill.
        assert "explanation" not in stored[0]
        assert stored[0]["question"] == "Q1?"
