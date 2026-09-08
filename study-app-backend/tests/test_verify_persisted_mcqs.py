"""
Tests for integration point B: MCQ verification against the database
(routes/tests.py _verify_persisted_mcqs, plus the wiring inside
_generate_questions_background).

Unlike test_mcq_verification.py, these tests need a real database, because
the logic under test IS the SQL/ORM behavior: recorrections, deletes, repair
inserts, the surplus-trim-spares-before-repairs rule, display_order
resequencing, and expected_question_count bookkeeping. Mocking the session
would just re-describe the code rather than verify it.

Uses an in-memory SQLite database (StaticPool, so all connections in one test
share the same in-memory DB) and monkeypatches src.routes.tests's module-level
async_session_maker to point at it. MCQVerificationService itself is mocked
(verify_and_repair) throughout, matching test_create_test.py's convention:
the decision table, matcher, and repair-call orchestration are already
exhaustively covered in test_mcq_verification.py.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.models.folder import Folder
from src.models.mcq_option import MCQOption
from src.models.question import Question
from src.models.test import Test as TestRow
from src.models.user import User
from src.models.user_attempt import UserAttempt
from src.services.mcq_verification_service import VerifiableMCQ

pytestmark = pytest.mark.asyncio

# db_session_maker fixture lives in conftest.py, shared with
# test_generate_questions_background_wiring.py.


async def _seed_test_with_mcqs(
    session_maker, mcq_texts_and_correct: list[tuple[str, int]], with_attempt: bool = False,
) -> int:
    """Seed a User/Folder/TestRow plus one MCQ question per (text, correct_index)
    pair, each with 4 options "A"/"B"/"C"/"D". Returns the test id."""
    async with session_maker() as session:
        user = User(email="u@example.com", google_id="g1")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="F1")
        session.add(folder)
        await session.flush()
        test = TestRow(folder_id=folder.id, title="T1", test_type="MCQ_only")
        session.add(test)
        await session.flush()
        for order, (text, correct_index) in enumerate(mcq_texts_and_correct, start=1):
            question = Question(test_id=test.id, question_text=text, question_type="MCQ", display_order=order)
            session.add(question)
            await session.flush()
            for i, letter in enumerate(["A", "B", "C", "D"]):
                session.add(MCQOption(
                    question_id=question.id, option_text=letter, is_correct=(i == correct_index), display_order=i + 1,
                ))
        if with_attempt:
            session.add(UserAttempt(user_id=user.id, test_id=test.id, attempt_number=1, status="in_progress"))
        await session.commit()
        return test.id


def _fake_verifier(kept, dropped_keys, new_items, stats=None):
    verifier = AsyncMock()
    verifier.verify_and_repair = AsyncMock(return_value=(kept, dropped_keys, new_items, stats or {"calls": 2}))
    return verifier


class TestVerifyPersistedMcqs:

    async def test_zero_requested_mcq_is_a_noop(self, db_session_maker):
        from src.routes.tests import _verify_persisted_mcqs

        test_id = await _seed_test_with_mcqs(db_session_maker, [("Q1?", 0)])
        with patch("src.routes.tests.async_session_maker", db_session_maker):
            await _verify_persisted_mcqs(
                test_id=test_id, source_content="notes", variant="prose", provider=None,
                requested_mcq=0, coding_language=None, test_type="MCQ_only", difficulty="mixed",
                topic_focus=None, custom_instructions=None,
            )
        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            assert test.expected_question_count is None  # untouched

    async def test_deleted_test_returns_quietly(self, db_session_maker):
        from src.routes.tests import _verify_persisted_mcqs

        with patch("src.routes.tests.async_session_maker", db_session_maker):
            # test_id 999 never existed; must not raise.
            await _verify_persisted_mcqs(
                test_id=999, source_content="notes", variant="prose", provider=None,
                requested_mcq=5, coding_language=None, test_type="MCQ_only", difficulty="mixed",
                topic_focus=None, custom_instructions=None,
            )

    async def test_recorrection_updates_options_in_place(self, db_session_maker):
        from src.routes.tests import _verify_persisted_mcqs

        test_id = await _seed_test_with_mcqs(db_session_maker, [("Q1?", 0)])
        async with db_session_maker() as session:
            question = (await session.execute(
                Question.__table__.select().where(Question.test_id == test_id)
            )).first()
            question_id = question.id

        kept = [VerifiableMCQ(key=question_id, question_text="Q1?", options=["A", "B", "C", "D"], correct_index=2)]
        fake = _fake_verifier(kept=kept, dropped_keys=[], new_items=[], stats={"recorrected": 1})

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.MCQVerificationService", return_value=fake),
        ):
            await _verify_persisted_mcqs(
                test_id=test_id, source_content="notes", variant="prose", provider=None,
                requested_mcq=1, coding_language=None, test_type="MCQ_only", difficulty="mixed",
                topic_focus=None, custom_instructions=None,
            )

        async with db_session_maker() as session:
            question = await session.get(Question, question_id)
            await session.refresh(question, attribute_names=["mcq_options"])
            correct = [o for o in question.mcq_options if o.is_correct]
            assert len(correct) == 1
            assert correct[0].option_text == "C"

    async def test_drop_removes_question_and_resequences(self, db_session_maker):
        from src.routes.tests import _verify_persisted_mcqs

        test_id = await _seed_test_with_mcqs(
            db_session_maker, [("Q1?", 0), ("Q2?", 0), ("Q3?", 0)],
        )
        async with db_session_maker() as session:
            rows = (await session.execute(
                Question.__table__.select().where(Question.test_id == test_id).order_by(Question.display_order)
            )).fetchall()
            ids = [r.id for r in rows]

        # Drop the middle question (Q2, display_order 2).
        kept = [
            VerifiableMCQ(key=ids[0], question_text="Q1?", options=["A", "B", "C", "D"], correct_index=0),
            VerifiableMCQ(key=ids[2], question_text="Q3?", options=["A", "B", "C", "D"], correct_index=0),
        ]
        fake = _fake_verifier(kept=kept, dropped_keys=[ids[1]], new_items=[], stats={"dropped": 1})

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.MCQVerificationService", return_value=fake),
        ):
            await _verify_persisted_mcqs(
                test_id=test_id, source_content="notes", variant="prose", provider=None,
                requested_mcq=3, coding_language=None, test_type="MCQ_only", difficulty="mixed",
                topic_focus=None, custom_instructions=None,
            )

        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            await session.refresh(test, attribute_names=["questions"])
            remaining = sorted(test.questions, key=lambda q: q.display_order)
            assert [q.question_text for q in remaining] == ["Q1?", "Q3?"]
            # No gap: resequenced to 1, 2.
            assert [q.display_order for q in remaining] == [1, 2]
            assert test.expected_question_count == 2

    async def test_repair_insert_lands_at_tail_and_updates_count(self, db_session_maker):
        from src.routes.tests import _verify_persisted_mcqs

        test_id = await _seed_test_with_mcqs(db_session_maker, [("Q1?", 0)])
        async with db_session_maker() as session:
            row = (await session.execute(
                Question.__table__.select().where(Question.test_id == test_id)
            )).first()
            q1_id = row.id

        # Q1 dropped, one repair item fills the hole.
        new_item = VerifiableMCQ(key=("repair", 0), question_text="Repaired?", options=["W", "X", "Y", "Z"], correct_index=1)
        fake = _fake_verifier(kept=[], dropped_keys=[q1_id], new_items=[new_item], stats={"dropped": 1, "repaired": 1})

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.MCQVerificationService", return_value=fake),
        ):
            await _verify_persisted_mcqs(
                test_id=test_id, source_content="notes", variant="prose", provider=None,
                requested_mcq=1, coding_language=None, test_type="MCQ_only", difficulty="mixed",
                topic_focus=None, custom_instructions=None,
            )

        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            await session.refresh(test, attribute_names=["questions"])
            assert len(test.questions) == 1
            repaired = test.questions[0]
            assert repaired.question_text == "Repaired?"
            await session.refresh(repaired, attribute_names=["mcq_options"])
            correct = [o.option_text for o in repaired.mcq_options if o.is_correct]
            assert correct == ["X"]
            assert test.expected_question_count == 1

    async def test_surplus_trim_prefers_spares_over_repairs(self, db_session_maker):
        """3 spares survive (all kept) plus 1 repair insert = 4 total, but only
        3 were requested: the trim must remove a SPARE, never the freshly
        repaired question that covers material the test would otherwise lose."""
        from src.routes.tests import _verify_persisted_mcqs

        test_id = await _seed_test_with_mcqs(
            db_session_maker, [("Q1?", 0), ("Q2?", 0), ("Q3?", 0)],
        )
        async with db_session_maker() as session:
            rows = (await session.execute(
                Question.__table__.select().where(Question.test_id == test_id).order_by(Question.display_order)
            )).fetchall()
            ids = [r.id for r in rows]

        kept = [
            VerifiableMCQ(key=ids[0], question_text="Q1?", options=["A", "B", "C", "D"], correct_index=0),
            VerifiableMCQ(key=ids[1], question_text="Q2?", options=["A", "B", "C", "D"], correct_index=0),
            VerifiableMCQ(key=ids[2], question_text="Q3?", options=["A", "B", "C", "D"], correct_index=0),
        ]
        new_item = VerifiableMCQ(key=("repair", 0), question_text="Repaired?", options=["A", "B", "C", "D"], correct_index=0)
        # Nothing was actually dropped in THIS run (this simulates a case where
        # verify_and_repair still returned a repair item, e.g. from a prior
        # partial state); requested_mcq=3 while 3 kept + 1 new = 4 survive.
        fake = _fake_verifier(kept=kept, dropped_keys=[], new_items=[new_item])

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.MCQVerificationService", return_value=fake),
        ):
            await _verify_persisted_mcqs(
                test_id=test_id, source_content="notes", variant="prose", provider=None,
                requested_mcq=3, coding_language=None, test_type="MCQ_only", difficulty="mixed",
                topic_focus=None, custom_instructions=None,
            )

        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            await session.refresh(test, attribute_names=["questions"])
            texts = {q.question_text for q in test.questions}
            assert len(test.questions) == 3
            assert "Repaired?" in texts  # the repair survives the trim
            assert len(texts & {"Q1?", "Q2?", "Q3?"}) == 2  # exactly one spare was trimmed

    async def test_has_attempts_applies_recorrections_only(self, db_session_maker):
        """A test with an existing attempt: recorrect, but never delete or
        insert, even when the verifier proposes drops and repairs."""
        from src.routes.tests import _verify_persisted_mcqs

        test_id = await _seed_test_with_mcqs(
            db_session_maker, [("Q1?", 0), ("Q2?", 0)], with_attempt=True,
        )
        async with db_session_maker() as session:
            rows = (await session.execute(
                Question.__table__.select().where(Question.test_id == test_id).order_by(Question.display_order)
            )).fetchall()
            ids = [r.id for r in rows]

        # Q1 recorrected, Q2 proposed for drop, one repair item proposed too.
        kept = [VerifiableMCQ(key=ids[0], question_text="Q1?", options=["A", "B", "C", "D"], correct_index=3)]
        new_item = VerifiableMCQ(key=("repair", 0), question_text="Repaired?", options=["A", "B", "C", "D"], correct_index=0)
        fake = _fake_verifier(kept=kept, dropped_keys=[ids[1]], new_items=[new_item])

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.MCQVerificationService", return_value=fake),
        ):
            await _verify_persisted_mcqs(
                test_id=test_id, source_content="notes", variant="prose", provider=None,
                requested_mcq=2, coding_language=None, test_type="MCQ_only", difficulty="mixed",
                topic_focus=None, custom_instructions=None,
            )

        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            await session.refresh(test, attribute_names=["questions"])
            # Still exactly 2 questions: no delete, no insert.
            assert len(test.questions) == 2
            q1 = next(q for q in test.questions if q.question_text == "Q1?")
            await session.refresh(q1, attribute_names=["mcq_options"])
            correct = [o.option_text for o in q1.mcq_options if o.is_correct]
            assert correct == ["D"]  # the recorrection still applied
            # expected_question_count untouched since no structural change.
            assert test.expected_question_count is None

    async def test_nothing_to_write_makes_no_db_changes(self, db_session_maker):
        """kept matches the stored state exactly, no drops, no repairs: the
        write phase must not even open a second session unnecessarily."""
        from src.routes.tests import _verify_persisted_mcqs

        test_id = await _seed_test_with_mcqs(db_session_maker, [("Q1?", 0)])
        async with db_session_maker() as session:
            row = (await session.execute(
                Question.__table__.select().where(Question.test_id == test_id)
            )).first()
            q1_id = row.id

        kept = [VerifiableMCQ(key=q1_id, question_text="Q1?", options=["A", "B", "C", "D"], correct_index=0)]
        fake = _fake_verifier(kept=kept, dropped_keys=[], new_items=[])

        with (
            patch("src.routes.tests.async_session_maker", db_session_maker),
            patch("src.routes.tests.MCQVerificationService", return_value=fake),
        ):
            await _verify_persisted_mcqs(
                test_id=test_id, source_content="notes", variant="prose", provider=None,
                requested_mcq=1, coding_language=None, test_type="MCQ_only", difficulty="mixed",
                topic_focus=None, custom_instructions=None,
            )

        async with db_session_maker() as session:
            test = await session.get(TestRow, test_id)
            assert test.expected_question_count is None  # never touched
