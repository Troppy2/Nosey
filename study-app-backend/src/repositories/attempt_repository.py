from __future__ import annotations

from sqlalchemy import Select, case, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import defer, selectinload

from src.models.question import Question
from src.models.test import Test
from src.models.user_answer import UserAnswer
from src.models.user_attempt import UserAttempt
from src.repositories.base_repository import BaseRepository
from src.schemas.attempt_schema import OCR_STATUS_NEEDS_INPUT, ResumableTestInfo
from typing import Optional


class AttemptRepository(BaseRepository[UserAttempt]):
    async def next_attempt_number(self, user_id: int, test_id: int) -> int:
        current = await self.session.scalar(
            select(func.max(UserAttempt.attempt_number)).where(
                UserAttempt.user_id == user_id,
                UserAttempt.test_id == test_id,
            )
        )
        return int(current or 0) + 1

    async def create(
        self, user_id: int, test_id: int, attempt_number: int, status: str = "in_progress"
    ) -> UserAttempt:
        attempt = UserAttempt(
            user_id=user_id, test_id=test_id, attempt_number=attempt_number, status=status
        )
        self.session.add(attempt)
        await self.session.flush()
        return attempt

    async def add_answer(
        self,
        attempt_id: int,
        question_id: int,
        user_answer: str,
        is_correct: Optional[bool],
        feedback: Optional[str],
        confidence: Optional[float],
        flagged_uncertain: bool,
        reasoning: Optional[str] = None,
        work_strokes: Optional[str] = None,
        work_transcript: Optional[str] = None,
        ocr_status: Optional[str] = None,
    ) -> UserAnswer:
        answer = UserAnswer(
            attempt_id=attempt_id,
            question_id=question_id,
            user_answer=user_answer,
            is_correct=is_correct,
            ai_feedback=feedback,
            ai_reasoning=reasoning,
            confidence_score=confidence,
            flagged_uncertain=flagged_uncertain,
            # Scratch-pad strokes (STEM Scratch Pad feature). Passed by
            # save_draft_attempt, and by a graded submission only for a
            # needs_input answer (GH #149). The rendered image is never
            # persisted either way.
            work_strokes=work_strokes,
            work_transcript=work_transcript,
            ocr_status=ocr_status,
        )
        self.session.add(answer)
        await self.session.flush()
        return answer

    async def list_for_test(self, user_id: int, test_id: int) -> list[UserAttempt]:
        rows = await self.session.scalars(
            select(UserAttempt)
            .where(
                UserAttempt.user_id == user_id,
                UserAttempt.test_id == test_id,
                UserAttempt.status == "submitted",
            )
            .order_by(UserAttempt.attempt_number.desc())
        )
        return list(rows.all())

    async def get_detail(self, attempt_id: int, user_id: int) -> Optional[UserAttempt]:
        # work_strokes is scratch-pad stroke JSON (up to 200KB per answer) that
        # the results view never reads. Loading it made opening a past attempt
        # pull megabytes off the DB for a STEM test worked on the scratch pad.
        return await self.session.scalar(
            select(UserAttempt)
            .where(UserAttempt.id == attempt_id, UserAttempt.user_id == user_id)
            .options(
                selectinload(UserAttempt.test),
                selectinload(UserAttempt.answers).options(
                    defer(UserAnswer.work_strokes),
                    selectinload(UserAnswer.question).options(
                        selectinload(Question.mcq_options),
                        selectinload(Question.frq_answer),
                        # A part's setup (GH #151), for Results and the review summary.
                        selectinload(Question.group),
                    ),
                ),
            )
        )

    async def get_answer(self, attempt_id: int, question_id: int) -> Optional[UserAnswer]:
        return await self.session.scalar(
            select(UserAnswer).where(
                UserAnswer.attempt_id == attempt_id, UserAnswer.question_id == question_id
            )
        )

    async def list_answers(self, attempt_id: int) -> list[UserAnswer]:
        rows = await self.session.scalars(select(UserAnswer).where(UserAnswer.attempt_id == attempt_id))
        return list(rows.all())

    async def get_pending_strokes(self, attempt_id: int) -> dict[int, str]:
        """Strokes of the needs_input answers only (GH #149).

        get_detail defers work_strokes for every answer; this loads it just
        for the few answers the student still has to fix.
        """
        rows = await self.session.execute(
            select(UserAnswer.question_id, UserAnswer.work_strokes).where(
                UserAnswer.attempt_id == attempt_id,
                UserAnswer.ocr_status == OCR_STATUS_NEEDS_INPUT,
                UserAnswer.work_strokes.is_not(None),
            )
        )
        return {question_id: strokes for question_id, strokes in rows.all()}

    async def provisional_attempt_ids(self, attempt_ids: list[int]) -> set[int]:
        """The attempts that still hold a needs_input answer (GH #149)."""
        if not attempt_ids:
            return set()
        rows = await self.session.scalars(
            select(UserAnswer.attempt_id)
            .where(
                UserAnswer.attempt_id.in_(attempt_ids),
                UserAnswer.ocr_status == OCR_STATUS_NEEDS_INPUT,
            )
            .distinct()
        )
        return set(rows.all())

    async def weakness(self, user_id: int, test_id: int) -> list[tuple[int, str, int, int, float]]:
        correct_count = func.sum(case((UserAnswer.is_correct.is_(True), 1), else_=0))
        total_count = func.count(UserAnswer.id)
        stmt: Select[tuple[int, str, int, int, float]] = (
            select(
                Question.id,
                Question.question_text,
                total_count.label("times_attempted"),
                correct_count.label("times_correct"),
                (correct_count / total_count).label("success_rate"),
            )
            .join(UserAnswer, UserAnswer.question_id == Question.id)
            .join(UserAttempt, UserAttempt.id == UserAnswer.attempt_id)
            .where(UserAttempt.user_id == user_id, UserAttempt.test_id == test_id)
            .group_by(Question.id, Question.question_text)
            .order_by((correct_count / total_count).asc())
        )
        rows = await self.session.execute(stmt)
        return list(rows.all())

    async def _select_draft_for_update(self, user_id: int, test_id: int) -> Optional[UserAttempt]:
        return await self.session.scalar(
            select(UserAttempt)
            .where(
                UserAttempt.user_id == user_id,
                UserAttempt.test_id == test_id,
                UserAttempt.status == "in_progress",
            )
            .with_for_update()
        )

    async def get_or_create_draft(self, user_id: int, test_id: int) -> UserAttempt:
        """Get the draft attempt, row-locked for the rest of the transaction.

        The lock serializes overlapping autosaves for one draft (GH #137):
        without it two saves interleaved their writes and the loser 500'd on
        uq_answer_attempt_question. Creation races are settled by the
        uq_attempt_one_draft partial index: the loser re-selects the winner's
        draft (blocking until it commits) instead of failing.
        """
        existing = await self._select_draft_for_update(user_id, test_id)
        if existing:
            return existing

        attempt_number = await self.next_attempt_number(user_id, test_id)
        try:
            async with self.session.begin_nested():
                return await self.create(user_id, test_id, attempt_number)
        except IntegrityError:
            existing = await self._select_draft_for_update(user_id, test_id)
            if existing is None:
                raise
            return existing

    async def sync_draft_answers(
        self, attempt_id: int, answers: dict[int, tuple[str, Optional[str]]]
    ) -> None:
        """Make the draft's answers match ``answers`` (question_id -> (text, strokes)).

        Updates rows in place, inserts new ones, deletes dropped ones. Rows that
        did not change are not rewritten, so a save after one edit no longer
        rewrites every answer's stroke JSON. Caller must hold the draft lock.
        """
        rows = await self.session.scalars(select(UserAnswer).where(UserAnswer.attempt_id == attempt_id))
        existing = {row.question_id: row for row in rows.all()}
        for question_id, row in existing.items():
            if question_id not in answers:
                await self.session.delete(row)
        for question_id, (user_answer, work_strokes) in answers.items():
            row = existing.get(question_id)
            if row is None:
                self.session.add(
                    UserAnswer(
                        attempt_id=attempt_id,
                        question_id=question_id,
                        user_answer=user_answer,
                        flagged_uncertain=False,
                        # Scratch-pad strokes (STEM Scratch Pad feature).
                        work_strokes=work_strokes,
                    )
                )
            else:
                if row.user_answer != user_answer:
                    row.user_answer = user_answer
                if row.work_strokes != work_strokes:
                    row.work_strokes = work_strokes
        await self.session.flush()

    async def get_draft(self, user_id: int, test_id: int) -> Optional[UserAttempt]:
        """Get the draft/in-progress attempt for a test."""
        return await self.session.scalar(
            select(UserAttempt)
            .where(
                UserAttempt.user_id == user_id,
                UserAttempt.test_id == test_id,
                UserAttempt.status == "in_progress",
            )
            .options(selectinload(UserAttempt.answers))
        )

    async def clear_answers(self, attempt_id: int) -> None:
        """Clear all answers for a draft attempt."""
        await self.session.execute(
            delete(UserAnswer).where(UserAnswer.attempt_id == attempt_id)
        )
        await self.session.flush()

    async def get_resumable_tests(self, user_id: int) -> list[ResumableTestInfo]:
        """Get tests with in-progress attempts that can be resumed."""
        answer_count = func.count(UserAnswer.id)
        stmt = (
            select(
                UserAttempt.id.label("attempt_id"),
                UserAttempt.attempt_number,
                Test.id.label("test_id"),
                Test.title,
                UserAttempt.exited_at,
                answer_count.label("answered_count"),
                func.count(Question.id).label("total_count"),
            )
            .join(Test, Test.id == UserAttempt.test_id)
            .join(Question, Question.test_id == Test.id)
            .outerjoin(UserAnswer, (UserAnswer.attempt_id == UserAttempt.id) & (UserAnswer.question_id == Question.id))
            .where(
                UserAttempt.user_id == user_id,
                UserAttempt.status == "in_progress",
                UserAttempt.exited_at.is_not(None),
            )
            .group_by(UserAttempt.id, UserAttempt.attempt_number, Test.id, Test.title, UserAttempt.exited_at)
            .order_by(UserAttempt.exited_at.desc())
        )
        rows = await self.session.execute(stmt)
        return [
            ResumableTestInfo(
                test_id=row.test_id,
                test_title=row.title,
                attempt_id=row.attempt_id,
                attempt_number=row.attempt_number,
                exited_at=row.exited_at,
                answered_question_count=row.answered_count or 0,
                total_question_count=row.total_count or 0,
            )
            for row in rows.all()
        ]

    async def get_recent_wrong_answers(self, user_id: int) -> Optional[tuple[UserAttempt, list[tuple[Question, UserAnswer]]]]:
        """Get the most recent test attempt with all wrong answers and their question details.
        Returns (attempt, [(question, wrong_answer), ...]) or None if no wrong answers found.
        """
        # Get most recent submitted attempt with wrong answers
        recent_attempt = await self.session.scalar(
            select(UserAttempt)
            .where(
                UserAttempt.user_id == user_id,
                UserAttempt.status == "submitted",
            )
            .order_by(UserAttempt.created_at.desc())
            .options(
                selectinload(UserAttempt.answers)
                .selectinload(UserAnswer.question)
                .selectinload(Question.mcq_options),
                selectinload(UserAttempt.answers)
                .selectinload(UserAnswer.question)
                .selectinload(Question.frq_answer),
                # A part's setup (GH #151), so Kojo sees the whole problem.
                selectinload(UserAttempt.answers)
                .selectinload(UserAnswer.question)
                .selectinload(Question.group),
                selectinload(UserAttempt.test),
            )
        )

        if not recent_attempt:
            return None

        # Filter for wrong answers only
        wrong_answers = [
            (answer.question, answer)
            for answer in recent_attempt.answers
            # A needs_input answer is not graded yet and its answer key is
            # hidden from the student (GH #149): Kojo must not reveal it.
            if answer.is_correct is False and answer.ocr_status != OCR_STATUS_NEEDS_INPUT
        ]

        if not wrong_answers:
            return None

        return (recent_attempt, wrong_answers)
