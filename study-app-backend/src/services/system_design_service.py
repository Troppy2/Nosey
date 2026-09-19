from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.system_design import SDConceptProgress
from src.repositories.system_design_repository import SystemDesignRepository
from src.schemas.system_design_schema import (
    CONCEPT_ID_PATTERN,
    EXERCISE_ID_PATTERN,
    MAX_FILE_NAME_LENGTH,
    MAX_FILES_PER_SUBMISSION,
    MAX_SUBMISSION_BYTES,
    SUB_MODULES,
    SDProgressDTO,
    SDSubmissionResponse,
)
from src.utils.exceptions import ValidationException


def validate_concept_id(concept_id: str) -> str:
    if not CONCEPT_ID_PATTERN.match(concept_id or ""):
        raise ValidationException("Invalid concept id")
    return concept_id


def validate_exercise_id(exercise_id: str) -> str:
    if not EXERCISE_ID_PATTERN.match(exercise_id or ""):
        raise ValidationException("Invalid exercise id")
    return exercise_id


def split_exercise_id(exercise_id: str) -> tuple[str, str]:
    """"<conceptId>:<visualizer|project>" -> (conceptId, kind)."""
    validate_exercise_id(exercise_id)
    concept_id, _, kind = exercise_id.partition(":")
    return concept_id, kind


class SystemDesignService:
    """Progress and autosave orchestration for System Design mode.

    Stateless and instantiated per request. Deliberately contains no LLM call:
    the feature's single LLM touchpoint is FRQ grading, which lives in
    SystemDesignQuizService so provider fallback stays isolated.
    """

    # ── reads ─────────────────────────────────────────────────────────────────

    async def get_progress(self, user_id: int, session: AsyncSession) -> dict[str, SDProgressDTO]:
        rows = await SystemDesignRepository(session).get_progress(user_id)
        return {concept_id: self._to_dto(row) for concept_id, row in rows.items()}

    async def get_submission(
        self, user_id: int, exercise_id: str, session: AsyncSession
    ) -> SDSubmissionResponse:
        validate_exercise_id(exercise_id)
        repo = SystemDesignRepository(session)
        row = await repo.get_submission(user_id, exercise_id)
        if row is None:
            return SDSubmissionResponse()
        return SDSubmissionResponse(
            files=repo.load_files(row),
            last_run_passed=row.last_run_passed,
            passed_at=row.passed_at,
        )

    # ── writes ────────────────────────────────────────────────────────────────

    async def mark_sub_module(
        self,
        user_id: int,
        concept_id: str,
        sub_module: str,
        done: bool,
        session: AsyncSession,
    ) -> SDProgressDTO:
        validate_concept_id(concept_id)
        if sub_module not in SUB_MODULES:
            raise ValidationException("Unknown sub-module")

        repo = SystemDesignRepository(session)
        row = await repo.upsert_progress(user_id, concept_id, **{f"{sub_module}_done": done})
        self.recompute_completed_at(row)
        await session.commit()
        return self._to_dto(row)

    async def save_submission(
        self,
        user_id: int,
        exercise_id: str,
        files: dict[str, str],
        ran_passed: bool,
        session: AsyncSession,
    ) -> SDSubmissionResponse:
        concept_id, kind = split_exercise_id(exercise_id)
        files = self._validate_files(files)

        repo = SystemDesignRepository(session)
        now = datetime.now(timezone.utc)
        existing = await repo.get_submission(user_id, exercise_id)
        # A failing run never takes away a pass the learner already earned, so
        # last_run_passed and passed_at only ever move forwards.
        already_passed = bool(existing and existing.last_run_passed)
        row = await repo.upsert_submission(
            user_id,
            exercise_id,
            files=files,
            last_run_passed=True if (ran_passed or already_passed) else False,
            passed_at=now if (ran_passed and (existing is None or existing.passed_at is None)) else None,
        )

        if ran_passed:
            progress = await repo.upsert_progress(user_id, concept_id, **{f"{kind}_done": True})
            self.recompute_completed_at(progress)

        await session.commit()
        return SDSubmissionResponse(
            files=repo.load_files(row),
            last_run_passed=row.last_run_passed,
            passed_at=row.passed_at,
        )

    # ── shared helpers ────────────────────────────────────────────────────────

    @staticmethod
    def recompute_completed_at(row: SDConceptProgress) -> None:
        """A concept is complete only while all five sub-modules are done.

        Public because the quiz service flips quiz_done on its own row and has to
        recompute the same way.
        """
        all_done = all(getattr(row, f"{name}_done") for name in SUB_MODULES)
        if all_done:
            if row.completed_at is None:
                row.completed_at = datetime.now(timezone.utc)
        else:
            row.completed_at = None

    @staticmethod
    def _to_dto(row: SDConceptProgress) -> SDProgressDTO:
        return SDProgressDTO(
            notes_done=row.notes_done,
            video_done=row.video_done,
            visualizer_done=row.visualizer_done,
            project_done=row.project_done,
            quiz_done=row.quiz_done,
            quiz_best_score=row.quiz_best_score,
            completed_at=row.completed_at,
        )

    @staticmethod
    def _validate_files(files: Optional[dict[str, str]]) -> dict[str, str]:
        files = files or {}
        if len(files) > MAX_FILES_PER_SUBMISSION:
            raise ValidationException("Too many files in this workspace")
        total = 0
        cleaned: dict[str, str] = {}
        for name, contents in files.items():
            name = str(name)
            contents = str(contents)
            if not name or len(name) > MAX_FILE_NAME_LENGTH:
                raise ValidationException("Invalid file name")
            total += len(contents.encode("utf-8"))
            if total > MAX_SUBMISSION_BYTES:
                raise ValidationException("Workspace is too large to save")
            cleaned[name] = contents
        return cleaned
