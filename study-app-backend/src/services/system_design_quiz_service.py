from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.system_design_repository import SystemDesignRepository
from src.schemas.attempt_schema import FRQGrade
from src.schemas.system_design_schema import (
    SDFrqFeedback,
    SDQuizGradeRequest,
    SDQuizGradeResponse,
)
from src.services.llm_service import LLMService
from src.services.system_design_service import SystemDesignService, validate_concept_id
from src.utils.exceptions import LLMException, ValidationException
from src.utils.logger import get_logger

logger = get_logger(__name__)

# Every concept ships exactly five written questions, so a request with any
# other number is a client bug, not something to score partially.
REQUIRED_FRQ_COUNT = 5
# Both gates have to clear. The weights frontload the written answers, which are
# the part that actually shows understanding.
MCQ_PASS_SCORE = 80
FRQ_PASS_SCORE = 60
FRQ_WEIGHT = 0.6
MCQ_WEIGHT = 0.4


class SystemDesignQuizService:
    """The single LLM touchpoint of System Design mode: grading the five FRQs.

    Isolated in its own service so the only provider loop involved is the one
    inside LLMService.grade_frq_answer. The gather below is NOT a provider loop
    and must never be wrapped in one: each call already falls back across
    providers on its own, and retrying here would multiply quota use.
    """

    async def grade(
        self,
        user_id: int,
        concept_id: str,
        payload: SDQuizGradeRequest,
        session: AsyncSession,
    ) -> SDQuizGradeResponse:
        validate_concept_id(concept_id)
        if len(payload.frq) != REQUIRED_FRQ_COUNT:
            raise ValidationException(
                f"Expected {REQUIRED_FRQ_COUNT} written answers, got {len(payload.frq)}"
            )

        mcq_score = self._percentage(
            sum(1 for item in payload.mcq if item.chosen_index == item.correct_index),
            len(payload.mcq),
        )

        llm = LLMService()
        results = await asyncio.gather(
            *(
                llm.grade_frq_answer(
                    notes=payload.notes,
                    question=item.prompt,
                    expected_answer=item.rubric,
                    user_answer=item.answer,
                )
                for item in payload.frq
            ),
            return_exceptions=True,
        )

        grades: list[FRQGrade] = []
        failures = 0
        for result in results:
            if isinstance(result, BaseException):
                failures += 1
                logger.warning("System Design FRQ grading failed for one question: %s", result)
                grades.append(
                    FRQGrade(is_correct=False, feedback="", flagged_uncertain=True, confidence=0.0)
                )
            else:
                grades.append(result)

        if failures == len(grades):
            # A total outage is not a failed quiz. Nothing is written, and the
            # route turns this into a 503 telling the user to try again.
            raise LLMException("Grading is temporarily unavailable, try again shortly.")

        frq_score = self._percentage(
            sum(1 for grade in grades if grade.is_correct), REQUIRED_FRQ_COUNT
        )
        total_score = round(MCQ_WEIGHT * mcq_score + FRQ_WEIGHT * frq_score)

        # A grader that could not grade anything must not read as a failed quiz:
        # the user is told to retry rather than silently marked wrong.
        grader_degraded = all(
            grade.flagged_uncertain and grade.confidence == 0.0 for grade in grades
        )
        passed = (
            not grader_degraded and mcq_score >= MCQ_PASS_SCORE and frq_score >= FRQ_PASS_SCORE
        )

        repo = SystemDesignRepository(session)
        await repo.add_quiz_attempt(
            user_id=user_id,
            concept_id=concept_id,
            mcq_answers=[
                {
                    "id": item.id,
                    "chosenIndex": item.chosen_index,
                    "correct": item.chosen_index == item.correct_index,
                }
                for item in payload.mcq
            ],
            frq_answers=[{"id": item.id, "answer": item.answer} for item in payload.frq],
            frq_grades=[
                {
                    "id": item.id,
                    "is_correct": grade.is_correct,
                    "feedback": grade.feedback or "",
                    "confidence": grade.confidence,
                    "flagged_uncertain": grade.flagged_uncertain,
                }
                for item, grade in zip(payload.frq, grades)
            ],
            mcq_score=mcq_score,
            frq_score=frq_score,
            total_score=total_score,
            passed=passed,
        )

        existing = await repo.get_concept_progress(user_id, concept_id)
        best_score = max(total_score, (existing.quiz_best_score if existing else None) or 0)
        progress = await repo.upsert_progress(
            user_id,
            concept_id,
            quiz_done=bool((existing and existing.quiz_done) or passed),
            quiz_best_score=best_score,
        )
        SystemDesignService.recompute_completed_at(progress)
        await session.commit()

        return SDQuizGradeResponse(
            mcq_score=mcq_score,
            frq_score=frq_score,
            total_score=total_score,
            passed=passed,
            grader_degraded=grader_degraded,
            frq_feedback=[
                SDFrqFeedback(
                    id=item.id,
                    is_correct=grade.is_correct,
                    feedback=grade.feedback or "",
                    confidence=grade.confidence,
                    flagged_uncertain=grade.flagged_uncertain,
                )
                for item, grade in zip(payload.frq, grades)
            ],
            concept_completed=progress.completed_at is not None,
        )

    @staticmethod
    def _percentage(correct: int, total: int) -> int:
        if total <= 0:
            return 0
        return round(100 * correct / total)
