from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.question import Question
from src.repositories.attempt_repository import AttemptRepository
from src.repositories.test_repository import TestRepository
from src.schemas.attempt_schema import (
    AnswerResult,
    AttemptDetail,
    AttemptResult,
    AttemptSummary,
    FRQGrade,
    SubmittedAnswer,
)
from src.schemas.test_schema import WeaknessResponse
from src.services.llm_service import LLMService
from src.utils.exceptions import ResourceNotFoundException, ValidationException


class GradingService:
    def __init__(self, llm_service: LLMService | None = None) -> None:
        self.llm_service = llm_service or LLMService()

    async def submit_and_grade(
        self,
        test_id: int,
        user_id: int,
        answers: list[SubmittedAnswer],
        session: AsyncSession,
    ) -> AttemptResult:
        test = await TestRepository(session).get_owned_with_questions(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        question_by_id = {question.id: question for question in test.questions}
        submitted_by_id = {answer.question_id: answer.answer for answer in answers}
        if not submitted_by_id:
            raise ValidationException("At least one answer is required")

        repo = AttemptRepository(session)
        attempt_number = await repo.next_attempt_number(user_id, test_id)
        attempt = await repo.create(user_id, test_id, attempt_number)
        notes = "\n\n".join(note.content for note in test.notes)
        results: list[AnswerResult] = []
        correct_count = 0

        is_math_mode = getattr(test, "is_math_mode", False)
        for question_id, user_answer in submitted_by_id.items():
            question = question_by_id.get(question_id)
            if question is None:
                raise ValidationException(f"Question {question_id} does not belong to this test")
            grade = await self._grade_question(question, user_answer, notes, is_math_mode=is_math_mode)
            if grade.is_correct:
                correct_count += 1
            await repo.add_answer(
                attempt.id,
                question.id,
                user_answer,
                grade.is_correct,
                grade.feedback,
                grade.confidence,
                grade.flagged_uncertain,
            )
            correct_answer = self._correct_answer_text(question)
            results.append(
                AnswerResult(
                    question_id=question.id,
                    question_text=question.question_text,
                    user_answer=user_answer,
                    correct_answer=correct_answer,
                    is_correct=grade.is_correct,
                    feedback=grade.feedback,
                    confidence=grade.confidence,
                    flagged_uncertain=grade.flagged_uncertain,
                    is_math=is_math_mode and question.question_type == "FRQ",
                )
            )

        total = len(results)
        score = round((correct_count / total) * 100, 2) if total else 0.0
        attempt.correct_count = correct_count
        attempt.total_questions = total
        attempt.total_score = score
        await session.commit()

        return AttemptResult(
            attempt_id=attempt.id,
            attempt_number=attempt_number,
            score=score,
            correct_count=correct_count,
            total=total,
            answers=results,
        )

    async def _grade_question(
        self, question: Question, user_answer: str, notes: str, is_math_mode: bool = False
    ) -> FRQGrade:
        if question.question_type == "MCQ":
            return self._grade_mcq(question, user_answer)
        if question.frq_answer is None:
            return FRQGrade(
                is_correct=False,
                feedback="This FRQ has no expected answer configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        if is_math_mode:
            return await self.llm_service.grade_math_answer(
                question=question.question_text,
                expected_answer=question.frq_answer.expected_answer,
                user_answer=user_answer,
            )
        return await self.llm_service.grade_frq_answer(
            notes=notes,
            question=question.question_text,
            expected_answer=question.frq_answer.expected_answer,
            user_answer=user_answer,
        )

    def _grade_mcq(self, question: Question, user_answer: str) -> FRQGrade:
        correct_options = [option for option in question.mcq_options if option.is_correct]
        correct = correct_options[0] if correct_options else None
        if correct is None:
            return FRQGrade(
                is_correct=False,
                feedback="This MCQ has no correct answer configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        normalized = user_answer.strip().lower()
        letter_index = ord(normalized[0]) - ord("a") if len(normalized) == 1 and normalized.isalpha() else -1
        chosen_by_letter = (
            question.mcq_options[letter_index] if 0 <= letter_index < len(question.mcq_options) else None
        )
        is_correct = normalized == correct.option_text.strip().lower() or chosen_by_letter == correct
        feedback = None if is_correct else f"The correct answer was: {correct.option_text}"
        return FRQGrade(
            is_correct=is_correct,
            feedback=feedback,
            flagged_uncertain=False,
            confidence=1.0,
        )

    def _correct_answer_text(self, question: Question) -> str | None:
        if question.question_type == "MCQ":
            correct = next((o for o in question.mcq_options if o.is_correct), None)
            return correct.option_text if correct else None
        if question.frq_answer is not None:
            return question.frq_answer.expected_answer
        return None

    async def list_attempts(
        self, test_id: int, user_id: int, session: AsyncSession
    ) -> list[AttemptSummary]:
        test = await TestRepository(session).get_owned_with_questions(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        attempts = await AttemptRepository(session).list_for_test(user_id, test_id)
        return [
            AttemptSummary(
                id=attempt.id,
                attempt_number=attempt.attempt_number,
                score=float(attempt.total_score or 0),
                correct_count=attempt.correct_count or 0,
                total=attempt.total_questions or 0,
                created_at=attempt.created_at,
            )
            for attempt in attempts
        ]

    async def get_attempt_detail(
        self, attempt_id: int, user_id: int, session: AsyncSession
    ) -> AttemptDetail:
        attempt = await AttemptRepository(session).get_detail(attempt_id, user_id)
        if attempt is None:
            raise ResourceNotFoundException("Attempt")
        return AttemptDetail(
            id=attempt.id,
            attempt_number=attempt.attempt_number,
            score=float(attempt.total_score or 0),
            correct_count=attempt.correct_count or 0,
            total=attempt.total_questions or 0,
            created_at=attempt.created_at,
            test_title=attempt.test.title if attempt.test else "",
            answers=[
                AnswerResult(
                    question_id=answer.question_id,
                    question_text=answer.question.question_text if answer.question else None,
                    user_answer=answer.user_answer,
                    correct_answer=self._correct_answer_text(answer.question) if answer.question else None,
                    is_correct=bool(answer.is_correct),
                    feedback=answer.ai_feedback,
                    confidence=float(answer.confidence_score)
                    if answer.confidence_score is not None
                    else None,
                    flagged_uncertain=answer.flagged_uncertain,
                )
                for answer in attempt.answers
            ],
        )

    async def get_weakness_detection(
        self, test_id: int, user_id: int, session: AsyncSession
    ) -> list[WeaknessResponse]:
        test = await TestRepository(session).get_owned_with_questions(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        rows = await AttemptRepository(session).weakness(user_id, test_id)
        responses: list[WeaknessResponse] = []
        for question_id, text, attempted, correct, rate in rows:
            success_rate = float(rate or 0.0)
            category = "weak" if success_rate < 0.5 else "review" if success_rate < 0.8 else "strong"
            responses.append(
                WeaknessResponse(
                    question_id=question_id,
                    question_text=text,
                    times_attempted=attempted,
                    times_correct=correct,
                    success_rate=round(success_rate, 2),
                    category=category,
                )
            )
        return responses
