from __future__ import annotations

import asyncio
import json
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.question import Question
from src.repositories.attempt_repository import AttemptRepository
from src.repositories.test_repository import TestRepository
from src.schemas.attempt_schema import (
    AnswerResult,
    AttemptDetail,
    AttemptResult,
    AttemptSummary,
    DraftAttemptAnswer,
    DraftAttemptResponse,
    FRQGrade,
    ResumableTestInfo,
    SaveDraftAttemptRequest,
    SubmittedAnswer,
)
from src.schemas.test_schema import WeaknessResponse
from src.services.llm_service import LLMService
from src.utils.exceptions import ResourceNotFoundException, ValidationException
from typing import Optional


class GradingService:
    def __init__(self, llm_service: Optional[LLMService] = None) -> None:
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

        for question_id in submitted_by_id:
            if question_by_id.get(question_id) is None:
                raise ValidationException(f"Question {question_id} does not belong to this test")

        repo = AttemptRepository(session)
        attempt_number = await repo.next_attempt_number(user_id, test_id)
        attempt = await repo.create(user_id, test_id, attempt_number)
        notes = "\n\n".join(note.content for note in test.notes)

        is_math_mode = getattr(test, "is_math_mode", False)
        is_coding_mode = getattr(test, "is_coding_mode", False)
        coding_language = getattr(test, "coding_language", None) or "Python"

        # Grade all questions in parallel — LLM calls for FRQ are concurrent, MCQ is instant
        pairs = [(question_by_id[qid], ans) for qid, ans in submitted_by_id.items()]
        grades = await asyncio.gather(*(
            self._grade_question(
                q, ans, notes,
                is_math_mode=is_math_mode,
                is_coding_mode=is_coding_mode,
                coding_language=coding_language,
            )
            for q, ans in pairs
        ))

        results: list[AnswerResult] = []
        correct_count = 0
        for (question, user_answer), grade in zip(pairs, grades):
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
        attempt.status = "submitted"  # Mark as submitted, no longer in-progress
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
        self,
        question: Question,
        user_answer: str,
        notes: str,
        is_math_mode: bool = False,
        is_coding_mode: bool = False,
        coding_language: str = "Python",
    ) -> FRQGrade:
        qtype = question.question_type
        
        if qtype == "MCQ":
            return self._grade_mcq(question, user_answer)
        
        if qtype == "select_all":
            return self._grade_select_all(question, user_answer)
        
        if qtype == "matching":
            return self._grade_matching(question, user_answer)
        
        if qtype == "ordering":
            return self._grade_ordering(question, user_answer)
        
        if qtype == "fill_blank":
            return self._grade_fill_blank(question, user_answer)
        
        # FRQ grading (existing logic)
        if question.frq_answer is None:
            return FRQGrade(
                is_correct=False,
                feedback="This FRQ has no expected answer configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        if is_coding_mode:
            return await self.llm_service.grade_code_answer(
                question=question.question_text,
                expected_answer=question.frq_answer.expected_answer,
                user_code=user_answer,
                language=coding_language,
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

    def _grade_matching(self, question: Question, user_answer: str) -> FRQGrade:
        """Grade matching question: all pairs must be correct for full credit."""
        if question.matching_answer is None:
            return FRQGrade(
                is_correct=False,
                feedback="This matching question has no answer key configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        try:
            correct_pairs = json.loads(question.matching_answer.pairs_json)
            user_pairs = json.loads(user_answer)
        except (json.JSONDecodeError, ValueError):
            return FRQGrade(
                is_correct=False,
                feedback="Could not parse your answer. Please ensure all pairs are properly formatted.",
                flagged_uncertain=False,
                confidence=0.5,
            )
        
        # Convert to sets of (left, right) tuples for comparison (order-independent)
        correct_set = {(pair["left"].strip().lower(), pair["right"].strip().lower()) for pair in correct_pairs}
        user_set = {(pair["left"].strip().lower(), pair["right"].strip().lower()) for pair in user_pairs}
        
        is_correct = correct_set == user_set
        if is_correct:
            feedback = None
        else:
            incorrect_pairs = user_set - correct_set
            missing_pairs = correct_set - user_set
            details = []
            if incorrect_pairs:
                details.append(f"Incorrect matches: {len(incorrect_pairs)}")
            if missing_pairs:
                details.append(f"Missing matches: {len(missing_pairs)}")
            feedback = "Some pairs were incorrect. " + ", ".join(details)
        
        return FRQGrade(
            is_correct=is_correct,
            feedback=feedback,
            flagged_uncertain=False,
            confidence=1.0,
        )

    def _grade_ordering(self, question: Question, user_answer: str) -> FRQGrade:
        """Grade ordering question: exact sequence must match. Partial credit for prefix matches."""
        if question.ordering_answer is None:
            return FRQGrade(
                is_correct=False,
                feedback="This ordering question has no answer key configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        try:
            correct_order = json.loads(question.ordering_answer.correct_order_json)
            user_order = json.loads(user_answer)
        except (json.JSONDecodeError, ValueError):
            return FRQGrade(
                is_correct=False,
                feedback="Could not parse your answer. Please ensure the order is properly formatted.",
                flagged_uncertain=False,
                confidence=0.5,
            )
        
        # Normalize for comparison (case-insensitive, whitespace-trimmed)
        correct_normalized = [item.strip().lower() for item in correct_order]
        user_normalized = [item.strip().lower() for item in user_order]
        
        is_correct = correct_normalized == user_normalized
        if is_correct:
            feedback = None
        else:
            # Calculate longest common prefix for partial credit insight
            prefix_len = 0
            for i in range(min(len(correct_normalized), len(user_normalized))):
                if correct_normalized[i] == user_normalized[i]:
                    prefix_len += 1
                else:
                    break
            feedback = f"Incorrect order. First {prefix_len} items are correct."
        
        return FRQGrade(
            is_correct=is_correct,
            feedback=feedback,
            flagged_uncertain=False,
            confidence=1.0,
        )

    def _grade_fill_blank(self, question: Question, user_answer: str) -> FRQGrade:
        """Grade fill-in-the-blank question: case-insensitive exact or synonym match."""
        if question.fill_blank_answer is None:
            return FRQGrade(
                is_correct=False,
                feedback="This fill-in-the-blank question has no answer key configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        try:
            acceptable = json.loads(question.fill_blank_answer.acceptable_answers_json)
        except (json.JSONDecodeError, ValueError):
            return FRQGrade(
                is_correct=False,
                feedback="Answer key could not be read.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        
        user_normalized = user_answer.strip().lower()
        acceptable_normalized = [ans.strip().lower() for ans in acceptable]
        
        is_correct = user_normalized in acceptable_normalized
        if is_correct:
            feedback = None
        else:
            feedback = f"Incorrect. The correct answer was: {acceptable[0]}"
        
        return FRQGrade(
            is_correct=is_correct,
            feedback=feedback,
            flagged_uncertain=False,
            confidence=1.0,
        )

    def _grade_select_all(self, question: Question, user_answer: str) -> FRQGrade:
        """Grade select-all question: user must select all correct and no incorrect options."""
        if question.select_all_answer is None:
            return FRQGrade(
                is_correct=False,
                feedback="This select-all question has no answer key configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        try:
            correct_indices = json.loads(question.select_all_answer.correct_indices_json)
            user_indices = json.loads(user_answer)
        except (json.JSONDecodeError, ValueError):
            return FRQGrade(
                is_correct=False,
                feedback="Could not parse your selection. Please ensure indices are properly formatted.",
                flagged_uncertain=False,
                confidence=0.5,
            )
        
        # Convert to sets for comparison
        correct_set = set(correct_indices)
        user_set = set(user_indices)
        
        is_correct = correct_set == user_set
        if is_correct:
            feedback = None
        else:
            missed = correct_set - user_set
            incorrect = user_set - correct_set
            details = []
            if missed:
                details.append(f"Missed {len(missed)} correct option(s)")
            if incorrect:
                details.append(f"Selected {len(incorrect)} incorrect option(s)")
            feedback = "Incomplete. " + "; ".join(details)
        
        return FRQGrade(
            is_correct=is_correct,
            feedback=feedback,
            flagged_uncertain=False,
            confidence=1.0,
        )

    def _correct_answer_text(self, question: Question) -> Optional[str]:
        qtype = question.question_type
        
        if qtype == "MCQ" or qtype == "select_all":
            # For MCQ and select_all, show correct options
            correct = [o for o in question.mcq_options if o.is_correct]
            if correct:
                return " | ".join(o.option_text for o in correct)
            return None
        
        if qtype == "matching" and question.matching_answer:
            try:
                pairs = json.loads(question.matching_answer.pairs_json)
                return str(pairs)
            except (json.JSONDecodeError, ValueError):
                return None
        
        if qtype == "ordering" and question.ordering_answer:
            try:
                order = json.loads(question.ordering_answer.correct_order_json)
                return " → ".join(order)
            except (json.JSONDecodeError, ValueError):
                return None
        
        if qtype == "fill_blank" and question.fill_blank_answer:
            try:
                answers = json.loads(question.fill_blank_answer.acceptable_answers_json)
                return answers[0] if answers else None
            except (json.JSONDecodeError, ValueError):
                return None
        
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
            test_id=attempt.test_id,
            folder_id=attempt.test.folder_id if attempt.test else None,
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

    async def save_draft_attempt(
        self,
        test_id: int,
        user_id: int,
        answers: list[DraftAttemptAnswer],
        session: AsyncSession,
    ) -> DraftAttemptResponse:
        """Save or update draft attempt with current answers."""
        test = await TestRepository(session).get_owned_with_questions(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")

        # Get or create draft attempt (status='in_progress')
        repo = AttemptRepository(session)
        attempt = await repo.get_or_create_draft(user_id, test_id)

        # Clear existing answers for this draft
        await repo.clear_answers(attempt.id)

        # Save new answers
        submitted_by_id = {answer.question_id: answer.user_answer for answer in answers}
        question_by_id = {question.id: question for question in test.questions}

        for question_id in submitted_by_id:
            if question_by_id.get(question_id) is None:
                raise ValidationException(f"Question {question_id} does not belong to this test")

        for question_id, user_answer in submitted_by_id.items():
            # Draft answers: is_correct is None (not graded yet)
            await repo.add_answer(
                attempt.id,
                question_id,
                user_answer,
                is_correct=None,
                feedback=None,
                confidence=None,
                flagged_uncertain=False,
            )

        # Update exit timestamp
        attempt.exited_at = datetime.utcnow()
        await session.commit()

        return DraftAttemptResponse(
            attempt_id=attempt.id,
            attempt_number=attempt.attempt_number,
            answers=answers,
            exited_at=attempt.exited_at,
        )

    async def get_draft_attempt(
        self,
        test_id: int,
        user_id: int,
        session: AsyncSession,
    ) -> DraftAttemptResponse:
        """Get the draft/in-progress attempt for a test."""
        test = await TestRepository(session).get_owned_with_questions(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")

        repo = AttemptRepository(session)
        attempt = await repo.get_draft(user_id, test_id)
        if attempt is None:
            raise ResourceNotFoundException("No draft attempt found for this test")

        # Convert answers to response format
        draft_answers = [
            DraftAttemptAnswer(question_id=ans.question_id, user_answer=ans.user_answer)
            for ans in attempt.answers
        ]

        return DraftAttemptResponse(
            attempt_id=attempt.id,
            attempt_number=attempt.attempt_number,
            answers=draft_answers,
            exited_at=attempt.exited_at,
        )

    async def get_resumable_tests(
        self,
        user_id: int,
        session: AsyncSession,
    ) -> list[ResumableTestInfo]:
        """Get list of tests with in-progress attempts that can be resumed."""
        return await AttemptRepository(session).get_resumable_tests(user_id)
