"""Draft autosave race fixes (GH #137).

SQLite cannot reproduce two Postgres transactions racing on a row lock, so
these pin the pieces the fix relies on: answers sync in place (no
delete-then-insert), and a draft-creation conflict falls back to the
existing draft instead of a 500.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from src.models.folder import Folder
from src.models.question import Question
from src.models.test import Test
from src.models.user import User
from src.models.user_answer import UserAnswer
from src.models.user_attempt import UserAttempt
from src.repositories.attempt_repository import AttemptRepository
from src.schemas.attempt_schema import DraftAttemptAnswer
from src.services.grading_service import GradingService


async def _seed(session):
    user = User(email="draft@example.com", google_id="g-draft")
    session.add(user)
    await session.flush()
    folder = Folder(user_id=user.id, name="OCaml")
    session.add(folder)
    await session.flush()
    test = Test(folder_id=folder.id, title="T", test_type="mixed")
    session.add(test)
    await session.flush()
    questions = [
        Question(test_id=test.id, question_text=f"Q{i}", question_type="FRQ", display_order=i)
        for i in range(3)
    ]
    session.add_all(questions)
    await session.commit()
    return user, test, [q.id for q in questions]


async def _answers(session, attempt_id):
    rows = await session.scalars(select(UserAnswer).where(UserAnswer.attempt_id == attempt_id))
    return {row.question_id: row for row in rows.all()}


@pytest.mark.asyncio
async def test_repeated_saves_update_in_place(db_session_maker):
    async with db_session_maker() as session:
        user, test, (q1, q2, q3) = await _seed(session)
        service = GradingService()

        first = await service.save_draft_attempt(
            test.id, user.id,
            [DraftAttemptAnswer(question_id=q1, user_answer="a"),
             DraftAttemptAnswer(question_id=q2, user_answer="b", work_strokes="S")],
            session,
        )
        before = await _answers(session, first.attempt_id)

        second = await service.save_draft_attempt(
            test.id, user.id,
            [DraftAttemptAnswer(question_id=q1, user_answer="a2"),
             DraftAttemptAnswer(question_id=q3, user_answer="c")],
            session,
        )
        after = await _answers(session, second.attempt_id)

    assert second.attempt_id == first.attempt_id
    assert set(after) == {q1, q3}
    assert after[q1].user_answer == "a2"
    # Updated in place, not deleted and re-inserted.
    assert after[q1].id == before[q1].id
    assert after[q3].user_answer == "c"


@pytest.mark.asyncio
async def test_draft_create_conflict_reuses_existing(db_session_maker, monkeypatch):
    async with db_session_maker() as session:
        user, test, _ = await _seed(session)
        repo = AttemptRepository(session)
        winner = await repo.get_or_create_draft(user.id, test.id)
        await session.commit()

        # Simulate losing the race: the first lookup misses the winner's draft.
        real_select = repo._select_draft_for_update
        calls = {"n": 0}

        async def flaky(user_id, test_id):
            calls["n"] += 1
            return None if calls["n"] == 1 else await real_select(user_id, test_id)

        monkeypatch.setattr(repo, "_select_draft_for_update", flaky)
        loser = await repo.get_or_create_draft(user.id, test.id)
        await session.commit()
        drafts = (await session.scalars(
            select(UserAttempt).where(UserAttempt.status == "in_progress")
        )).all()

    assert loser.id == winner.id
    assert len(drafts) == 1


@pytest.mark.asyncio
async def test_submitted_attempt_does_not_collide_with_draft(db_session_maker):
    async with db_session_maker() as session:
        user, test, _ = await _seed(session)
        repo = AttemptRepository(session)
        await repo.get_or_create_draft(user.id, test.id)
        # submit_and_grade creates its attempt as submitted, so a draft an
        # overlapping autosave committed cannot block the submission.
        await repo.create(user.id, test.id, 2, status="submitted")
        await session.commit()
