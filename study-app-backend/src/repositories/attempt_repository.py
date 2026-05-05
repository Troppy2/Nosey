from __future__ import annotations

from sqlalchemy import Select, case, delete, func, select
from sqlalchemy.orm import selectinload

from src.models.question import Question
from src.models.test import Test
from src.models.user_answer import UserAnswer
from src.models.user_attempt import UserAttempt
from src.repositories.base_repository import BaseRepository
from src.schemas.attempt_schema import ResumableTestInfo
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

    async def create(self, user_id: int, test_id: int, attempt_number: int) -> UserAttempt:
        attempt = UserAttempt(user_id=user_id, test_id=test_id, attempt_number=attempt_number)
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
    ) -> UserAnswer:
        answer = UserAnswer(
            attempt_id=attempt_id,
            question_id=question_id,
            user_answer=user_answer,
            is_correct=is_correct,
            ai_feedback=feedback,
            confidence_score=confidence,
            flagged_uncertain=flagged_uncertain,
        )
        self.session.add(answer)
        await self.session.flush()
        return answer

    async def list_for_test(self, user_id: int, test_id: int) -> list[UserAttempt]:
        rows = await self.session.scalars(
            select(UserAttempt)
            .where(UserAttempt.user_id == user_id, UserAttempt.test_id == test_id)
            .order_by(UserAttempt.attempt_number.desc())
        )
        return list(rows.all())

    async def get_detail(self, attempt_id: int, user_id: int) -> Optional[UserAttempt]:
        from src.models.question import Question
        from src.models.mcq_option import MCQOption
        from src.models.frq_answer import FRQAnswer
        from src.models.test import Test
        return await self.session.scalar(
            select(UserAttempt)
            .where(UserAttempt.id == attempt_id, UserAttempt.user_id == user_id)
            .options(
                selectinload(UserAttempt.test),
                selectinload(UserAttempt.answers).selectinload(UserAnswer.question).selectinload(Question.mcq_options),
                selectinload(UserAttempt.answers).selectinload(UserAnswer.question).selectinload(Question.frq_answer),
            )
        )

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

    async def get_or_create_draft(self, user_id: int, test_id: int) -> UserAttempt:
        """Get existing draft attempt or create a new one."""
        existing = await self.session.scalar(
            select(UserAttempt).where(
                UserAttempt.user_id == user_id,
                UserAttempt.test_id == test_id,
                UserAttempt.status == "in_progress",
            )
        )
        if existing:
            return existing

        # Create new draft
        attempt_number = await self.next_attempt_number(user_id, test_id)
        return await self.create(user_id, test_id, attempt_number)

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
                selectinload(UserAttempt.test),
            )
        )

        if not recent_attempt:
            return None

        # Filter for wrong answers only
        wrong_answers = [
            (answer.question, answer)
            for answer in recent_attempt.answers
            if answer.is_correct is False
        ]

        if not wrong_answers:
            return None

        return (recent_attempt, wrong_answers)
