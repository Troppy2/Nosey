from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select

from src.models.system_design import SDConceptProgress, SDQuizAttempt, SDSubmission
from src.repositories.base_repository import BaseRepository


class SystemDesignRepository(BaseRepository[SDConceptProgress]):
    """All System Design DB access. Nothing here commits: the callers own the
    transaction boundary, which keeps a progress flip and a submission save in
    the same unit of work."""

    # ── progress ──────────────────────────────────────────────────────────────

    async def get_progress(self, user_id: int) -> dict[str, SDConceptProgress]:
        rows = (
            await self.session.execute(
                select(SDConceptProgress).where(SDConceptProgress.user_id == user_id)
            )
        ).scalars().all()
        return {row.concept_id: row for row in rows}

    async def get_concept_progress(self, user_id: int, concept_id: str) -> Optional[SDConceptProgress]:
        return await self.session.scalar(
            select(SDConceptProgress).where(
                SDConceptProgress.user_id == user_id,
                SDConceptProgress.concept_id == concept_id,
            )
        )

    async def upsert_progress(self, user_id: int, concept_id: str, **fields: Any) -> SDConceptProgress:
        row = await self.get_concept_progress(user_id, concept_id)
        if row is None:
            row = SDConceptProgress(user_id=user_id, concept_id=concept_id)
            self.session.add(row)
        for key, value in fields.items():
            setattr(row, key, value)
        await self.session.flush()
        return row

    # ── submissions ───────────────────────────────────────────────────────────

    async def get_submission(self, user_id: int, exercise_id: str) -> Optional[SDSubmission]:
        return await self.session.scalar(
            select(SDSubmission).where(
                SDSubmission.user_id == user_id,
                SDSubmission.exercise_id == exercise_id,
            )
        )

    async def upsert_submission(
        self,
        user_id: int,
        exercise_id: str,
        files: dict[str, str],
        last_run_passed: Optional[bool] = None,
        passed_at: Optional[datetime] = None,
    ) -> SDSubmission:
        row = await self.get_submission(user_id, exercise_id)
        if row is None:
            row = SDSubmission(user_id=user_id, exercise_id=exercise_id)
            self.session.add(row)
        row.files_json = json.dumps(files, ensure_ascii=False)
        if last_run_passed is not None:
            row.last_run_passed = last_run_passed
        if passed_at is not None:
            row.passed_at = passed_at
        await self.session.flush()
        return row

    @staticmethod
    def load_files(row: SDSubmission) -> dict[str, str]:
        """Decode files_json defensively. A corrupt blob reads as an empty
        workspace rather than failing the whole request, so a learner's next
        autosave can overwrite it."""
        try:
            data = json.loads(row.files_json)
        except Exception:
            return {}
        if not isinstance(data, dict):
            return {}
        return {str(name): str(contents) for name, contents in data.items()}

    # ── quiz attempts ─────────────────────────────────────────────────────────

    async def add_quiz_attempt(
        self,
        user_id: int,
        concept_id: str,
        mcq_answers: list[dict[str, Any]],
        frq_answers: list[dict[str, Any]],
        frq_grades: list[dict[str, Any]],
        mcq_score: int,
        frq_score: int,
        total_score: int,
        passed: bool,
    ) -> SDQuizAttempt:
        attempt = SDQuizAttempt(
            user_id=user_id,
            concept_id=concept_id,
            mcq_answers_json=json.dumps(mcq_answers, ensure_ascii=False),
            frq_answers_json=json.dumps(frq_answers, ensure_ascii=False),
            frq_grades_json=json.dumps(frq_grades, ensure_ascii=False),
            mcq_score=mcq_score,
            frq_score=frq_score,
            total_score=total_score,
            passed=passed,
        )
        self.session.add(attempt)
        await self.session.flush()
        return attempt

    async def list_quiz_attempts(self, user_id: int, concept_id: str) -> list[SDQuizAttempt]:
        return list(
            (
                await self.session.execute(
                    select(SDQuizAttempt)
                    .where(
                        SDQuizAttempt.user_id == user_id,
                        SDQuizAttempt.concept_id == concept_id,
                    )
                    .order_by(SDQuizAttempt.id)
                )
            ).scalars().all()
        )
