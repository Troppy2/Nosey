from __future__ import annotations

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import selectinload

from src.models.question import Question
from src.models.user_answer import UserAnswer
from src.models.user_attempt import UserAttempt
from src.repositories.base_repository import BaseRepository


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
        is_correct: bool,
        feedback: str | None,
        confidence: float | None,
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

    async def get_detail(self, attempt_id: int, user_id: int) -> UserAttempt | None:
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
