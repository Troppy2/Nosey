"""Phase 4 verification for the STEM Scratch Pad draft-strokes column.

Uses a throwaway in-memory SQLite DB, not the shared Neon instance: this
branch's migration chain (052_add_scratch_pad_strokes) cannot be verified
against the shared DB right now because the episode-formats branch's
051_add_track_formats migration, which it depends on, is not merged to
feature yet. See the migration file's docstring.

Verifies (matching Phase 4's plan checklist):
  1. Saving a draft with work_strokes persists it.
  2. Reloading the draft (simulating "a different browser") returns the same
     strokes.
  3. Submitting the attempt deletes the draft, so strokes are gone after
     submit, and a graded UserAnswer never carries strokes.

Run: PYTHONPATH=. ../.venv/Scripts/python.exe scripts/verify_draft_strokes.py
"""
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.models.base import Base
# Import every model so Base.metadata knows about all tables (FKs).
from src.models import (  # noqa: F401
    conversation_file, flashcard, folder, folder_file, frq_answer,
    job_description, kojo_action_card, kojo_conversation, kojo_message,
    lc_sync, learning_module, mcq_option, mock_interview, note,
    question, slash_command, survey_response, test, usage_event, user,
    user_answer, user_attempt, user_memory,
)
from src.models.folder import Folder
from src.models.question import Question
from src.models.test import Test
from src.models.user import User
from src.schemas.attempt_schema import DraftAttemptAnswer, SubmittedAnswer
from src.services.grading_service import GradingService


async def main() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async with session_maker() as session:
        user_row = User(email="scratchpad-test@nosey.guest", google_id="test-google-id", is_beta=True)
        session.add(user_row)
        await session.flush()

        folder_row = Folder(user_id=user_row.id, name="Test Folder", subject="Math")
        session.add(folder_row)
        await session.flush()

        test_row = Test(
            folder_id=folder_row.id, title="Draft Strokes Test", test_type="practice",
            is_math_mode=True,
        )
        session.add(test_row)
        await session.flush()

        question_row = Question(
            test_id=test_row.id, question_type="FRQ", question_text="Solve for x: 2x = 8",
            display_order=0,
        )
        session.add(question_row)
        await session.flush()
        await session.commit()

        service = GradingService()

        print("=== 1. Save draft with strokes ===")
        strokes_json = '{"version":1,"strokes":[[10.0,20.0,15.5,25.5]]}'
        draft = await service.save_draft_attempt(
            test_row.id, user_row.id,
            [DraftAttemptAnswer(question_id=question_row.id, user_answer="", work_strokes=strokes_json)],
            session,
        )
        print(f"draft saved, attempt_id={draft.attempt_id}")

        print("\n=== 2. Reload draft (simulates a different browser) ===")
        reloaded = await service.get_draft_attempt(test_row.id, user_row.id, session)
        got_strokes = reloaded.answers[0].work_strokes if reloaded.answers else None
        print(f"work_strokes round-tripped: {got_strokes == strokes_json}")
        if got_strokes != strokes_json:
            print(f"  MISMATCH: got {got_strokes!r}")

        print("\n=== 3. Submit deletes the draft; strokes gone; graded row carries none ===")
        result = await service.submit_and_grade(
            test_row.id, user_row.id,
            [SubmittedAnswer(question_id=question_row.id, answer="x = 4")],
            session,
        )
        print(f"submitted, attempt_id={result.attempt_id}, score={result.score}")

        try:
            await service.get_draft_attempt(test_row.id, user_row.id, session)
            print("FAIL: draft still exists after submit")
        except Exception as exc:
            print(f"PASS: draft is gone after submit ({type(exc).__name__}: {exc})")

        from sqlalchemy import select
        from src.models.user_answer import UserAnswer
        graded_row = (
            await session.execute(
                select(UserAnswer).where(UserAnswer.attempt_id == result.attempt_id)
            )
        ).scalar_one()
        print(f"graded UserAnswer.work_strokes: {graded_row.work_strokes!r} (expect None)")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
