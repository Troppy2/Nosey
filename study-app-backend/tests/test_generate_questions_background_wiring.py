"""
Wiring tests for _generate_questions_background: confirms MCQ verification
(_verify_persisted_mcqs) is invoked correctly from both the non-streaming and
streaming sub-paths, exactly once regardless of which one ran, with the
INFLATED count going to generation and the RAW requested count going to
verification. The DB reconciliation logic itself (_verify_persisted_mcqs's
recorrect/drop/repair/trim/resequence behavior) is covered in
test_verify_persisted_mcqs.py; here _verify_persisted_mcqs is mocked so these
tests isolate the wiring in routes/tests.py.

Uses the db_session_maker fixture from conftest.py because generation really
does persist questions to the database as it runs (persist_batch /
persist_streamed_question); only the verification phase is mocked.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.folder import Folder
from src.models.test import Test as TestRow
from src.models.user import User
from src.services.llm_service import GeneratedFRQ, GeneratedMCQ
from src.services.mcq_verification_service import inflated_mcq_count

pytestmark = pytest.mark.asyncio


_seed_counter = 0


async def _seed_bare_test(session_maker, test_type: str = "MCQ_only") -> int:
    global _seed_counter
    _seed_counter += 1
    async with session_maker() as session:
        user = User(email=f"u{_seed_counter}@example.com", google_id=f"g{_seed_counter}")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="F1")
        session.add(folder)
        await session.flush()
        test = TestRow(folder_id=folder.id, title="T1", test_type=test_type)
        session.add(test)
        await session.commit()
        return test.id


def _make_mcqs(n: int, prefix: str = "Q") -> list[GeneratedMCQ]:
    return [GeneratedMCQ(f"{prefix}{i}?", ["A", "B", "C", "D"], 0) for i in range(n)]


def _fake_generate_test_questions():
    """An AsyncMock-compatible fake that streams through on_question when
    given one (mirroring the real streamed provider path) and always returns
    the full (mcq, frq) tuple too, matching generate_test_questions's actual
    contract."""
    async def _fake(**kwargs):
        mcqs = _make_mcqs(kwargs.get("count_mcq", 0))
        frqs: list[GeneratedFRQ] = []
        on_question = kwargs.get("on_question")
        if on_question is not None:
            for item in mcqs:
                await on_question("mcq", item)
        return mcqs, frqs
    return _fake


def _make_llm_mock(fake_generate) -> MagicMock:
    llm = MagicMock()
    llm.generate_test_questions = AsyncMock(side_effect=fake_generate)
    llm.generate_from_practice_test_template = AsyncMock(side_effect=fake_generate)
    llm.parse_practice_test = AsyncMock(return_value=([], []))
    llm.generate_extra_question_types = AsyncMock(return_value=([], [], []))
    return llm


class TestGenerateQuestionsBackgroundVerificationWiring:

    async def test_non_streaming_path_calls_verification_once_with_raw_count(
        self, db_session_maker, monkeypatch,
    ):
        from src.routes.tests import _generate_questions_background

        monkeypatch.setattr("src.routes.tests.settings.mcq_verification_enabled", True)
        test_id = await _seed_bare_test(db_session_maker)
        llm = _make_llm_mock(_fake_generate_test_questions())

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.LLMService", return_value=llm),
            patch("src.routes.tests._verify_persisted_mcqs", new=AsyncMock()) as fake_verify,
        ):
            await _generate_questions_background(
                test_id=test_id, user_id=1, notes_content="some notes",
                practice_test_content="", test_type="MCQ_only",
                count_mcq=3, count_frq=0, is_math_mode=False, difficulty="mixed",
                topic_focus=None, is_coding_mode=False, coding_language=None,
                custom_instructions=None, provider=None, enable_fallback=True,
            )

        # total_main (inflated) stays <= _FIRST_BATCH_SIZE (5), so this must
        # have taken the single-call non-streaming branch.
        assert llm.generate_test_questions.await_count == 1
        generation_kwargs = llm.generate_test_questions.call_args.kwargs
        assert generation_kwargs["count_mcq"] == inflated_mcq_count(3)

        fake_verify.assert_awaited_once()
        verify_kwargs = fake_verify.call_args.kwargs
        assert verify_kwargs["requested_mcq"] == 3  # the RAW request, never inflated
        assert verify_kwargs["variant"] == "prose"
        assert verify_kwargs["test_id"] == test_id

        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            assert test.generation_status == "ready"

    async def test_streaming_path_calls_verification_exactly_once(self, db_session_maker, monkeypatch):
        from src.routes.tests import _generate_questions_background

        monkeypatch.setattr("src.routes.tests.settings.mcq_verification_enabled", True)
        test_id = await _seed_bare_test(db_session_maker)
        llm = _make_llm_mock(_fake_generate_test_questions())

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.LLMService", return_value=llm),
            patch("src.routes.tests._verify_persisted_mcqs", new=AsyncMock()) as fake_verify,
        ):
            await _generate_questions_background(
                test_id=test_id, user_id=1, notes_content="some notes",
                practice_test_content="", test_type="MCQ_only",
                count_mcq=10, count_frq=0, is_math_mode=False, difficulty="mixed",
                topic_focus=None, is_coding_mode=False, coding_language=None,
                custom_instructions=None, provider=None, enable_fallback=True,
            )

        # inflated_mcq_count(10) = 13 > _FIRST_BATCH_SIZE (5): two generation
        # calls (first batch of 5, then the streamed remainder of 8), but
        # verification must still run exactly ONCE, as a reconciliation phase
        # after everything is persisted, never per batch.
        assert llm.generate_test_questions.await_count == 2
        first_call_kwargs = llm.generate_test_questions.call_args_list[0].kwargs
        second_call_kwargs = llm.generate_test_questions.call_args_list[1].kwargs
        assert first_call_kwargs["count_mcq"] == 5
        assert second_call_kwargs["count_mcq"] == inflated_mcq_count(10) - 5

        fake_verify.assert_awaited_once()
        assert fake_verify.call_args.kwargs["requested_mcq"] == 10

        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            assert test.generation_status == "ready"

    async def test_disabled_flag_skips_verification_and_inflation(self, db_session_maker, monkeypatch):
        from src.routes.tests import _generate_questions_background

        monkeypatch.setattr("src.routes.tests.settings.mcq_verification_enabled", False)
        test_id = await _seed_bare_test(db_session_maker)
        llm = _make_llm_mock(_fake_generate_test_questions())

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.LLMService", return_value=llm),
            patch("src.routes.tests._verify_persisted_mcqs", new=AsyncMock()) as fake_verify,
        ):
            await _generate_questions_background(
                test_id=test_id, user_id=1, notes_content="some notes",
                practice_test_content="", test_type="MCQ_only",
                count_mcq=3, count_frq=0, is_math_mode=False, difficulty="mixed",
                topic_focus=None, is_coding_mode=False, coding_language=None,
                custom_instructions=None, provider=None, enable_fallback=True,
            )

        fake_verify.assert_not_called()
        generation_kwargs = llm.generate_test_questions.call_args.kwargs
        assert generation_kwargs["count_mcq"] == 3  # no inflation when disabled

    async def test_parse_only_path_never_calls_verification(self, db_session_maker, monkeypatch):
        """practice_test_content alone (no notes): the extraction-only path,
        explicitly out of scope per the plan (its answer key comes from the
        student's own document, not model invention)."""
        from src.routes.tests import _generate_questions_background

        monkeypatch.setattr("src.routes.tests.settings.mcq_verification_enabled", True)
        test_id = await _seed_bare_test(db_session_maker)
        llm = _make_llm_mock(_fake_generate_test_questions())
        llm.parse_practice_test = AsyncMock(return_value=(_make_mcqs(3), []))

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.LLMService", return_value=llm),
            patch("src.routes.tests._verify_persisted_mcqs", new=AsyncMock()) as fake_verify,
        ):
            await _generate_questions_background(
                test_id=test_id, user_id=1, notes_content="",
                practice_test_content="some extracted practice test text", test_type="MCQ_only",
                count_mcq=3, count_frq=0, is_math_mode=False, difficulty="mixed",
                topic_focus=None, is_coding_mode=False, coding_language=None,
                custom_instructions=None, provider=None, enable_fallback=True,
            )

        fake_verify.assert_not_called()
        llm.parse_practice_test.assert_awaited_once()

    async def test_verification_failure_does_not_block_ready_status(self, db_session_maker, monkeypatch):
        from src.routes.tests import _generate_questions_background

        monkeypatch.setattr("src.routes.tests.settings.mcq_verification_enabled", True)
        test_id = await _seed_bare_test(db_session_maker)
        llm = _make_llm_mock(_fake_generate_test_questions())

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.LLMService", return_value=llm),
            patch(
                "src.routes.tests._verify_persisted_mcqs",
                new=AsyncMock(side_effect=Exception("verification exploded")),
            ),
        ):
            await _generate_questions_background(
                test_id=test_id, user_id=1, notes_content="some notes",
                practice_test_content="", test_type="MCQ_only",
                count_mcq=3, count_frq=0, is_math_mode=False, difficulty="mixed",
                topic_focus=None, is_coding_mode=False, coding_language=None,
                custom_instructions=None, provider=None, enable_fallback=True,
            )

        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            # A verification failure must never block the test from reaching
            # "ready" (it must not become "failed").
            assert test.generation_status == "ready"

    async def test_math_and_coding_variants_are_forwarded(self, db_session_maker, monkeypatch):
        from src.routes.tests import _generate_questions_background

        monkeypatch.setattr("src.routes.tests.settings.mcq_verification_enabled", True)

        for is_math, is_coding, expected_variant in (
            (True, False, "math"),
            (False, True, "coding"),
            (False, False, "prose"),
        ):
            test_id = await _seed_bare_test(db_session_maker)
            llm = _make_llm_mock(_fake_generate_test_questions())
            with (
                patch("src.routes.tests.async_session_maker", db_session_maker),
                patch("src.routes.tests.LLMService", return_value=llm),
                patch("src.routes.tests._verify_persisted_mcqs", new=AsyncMock()) as fake_verify,
            ):
                await _generate_questions_background(
                    test_id=test_id, user_id=1, notes_content="some notes",
                    practice_test_content="", test_type="MCQ_only",
                    count_mcq=3, count_frq=0, is_math_mode=is_math, difficulty="mixed",
                    topic_focus=None, is_coding_mode=is_coding, coding_language="Python",
                    custom_instructions=None, provider=None, enable_fallback=True,
                )
            assert fake_verify.call_args.kwargs["variant"] == expected_variant
