from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.question import Question, full_question_text
from src.models.user_attempt import UserAttempt
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
    OCR_LOW_CONFIDENCE_THRESHOLD,
    OCR_STATUS_NEEDS_INPUT,
    OCR_STATUS_OK,
    OCR_STATUS_RESOLVED,
    OCR_STATUS_SKIPPED,
    OcrResult,
    RedoAnswerRequest,
    RedoAnswerResponse,
    ResumableTestInfo,
    SaveDraftAttemptRequest,
    SubmittedAnswer,
)
from src.schemas.test_schema import WeaknessResponse
from src.services.llm_service import LLMService
from src.services.ocr_service import OcrService, is_read_from_drawing
from src.utils.exceptions import ResourceNotFoundException, ValidationException
from src.utils.logger import get_logger
from typing import Optional

logger = get_logger(__name__)

# Max wall-clock a single scratch-pad transcription may take before grading
# proceeds without it (STEM Scratch Pad feature). OCR must never extend the
# request beyond the existing grading budget; a slow OCR call degrades to
# work=None exactly like a failed one.
_OCR_TIMEOUT_SECONDS = 45
# Bounds concurrent vision calls within one submission, independent of how
# many questions carry a drawing. Created fresh per submit_and_grade call
# below, never as a module-level or instance attribute: an asyncio primitive
# bound to a dead event loop is a classic prod-only bug, and CLAUDE.md bans
# shared mutable state on services.
_OCR_CONCURRENCY = 3

# ── Related questions (GH #155) ─────────────────────────────────────────────
# "question 2", "Q2", "problem 2", "#2", numbered as the student sees them.
_QUESTION_REF_RE = re.compile(r"\b(?:question|problem|q|#)\s*(\d{1,3})\b", re.IGNORECASE)
# "part (a)" or "part a" (tests made before multi-part groups existed).
_PART_REF_RE = re.compile(r"\bparts?\s*(?:\(([a-h])\)|([a-h])\b)", re.IGNORECASE)
_PREVIOUS_RE = re.compile(r"\b(?:previous|preceding|prior|last|above)\s+(?:question|problem|part)\b", re.IGNORECASE)
_LEADING_PART_RE = re.compile(r"^\s*\(?([a-h])[).:]\s", re.IGNORECASE)
_MAX_RELATED = 4
_RELATED_ANSWER_CHARS = 1500
_UNREADABLE_CONTEXT = "(their handwriting for this one could not be read yet)"


def related_questions(question: Question, ordered: list[Question]) -> list[Question]:
    """Earlier questions this one builds on (GH #155).

    A part of a multi-part problem builds on every earlier part of its
    group. Any question also builds on what its text points back to:
    "question 2" / "Q2", "part (a)" (the nearest earlier question starting
    with that label, for tests made before groups existed), or "the previous
    question". Only EARLIER questions count, so grading order has no cycles.
    """
    index = next((i for i, q in enumerate(ordered) if q.id == question.id), None)
    if not index:
        return []
    earlier = ordered[:index]
    found: dict[int, Question] = {}
    if question.group_id is not None:
        for q in earlier:
            if q.group_id == question.group_id:
                found[q.id] = q
    text = question.question_text
    for match in _QUESTION_REF_RE.finditer(text):
        number = int(match.group(1))
        if 1 <= number <= index:
            found[ordered[number - 1].id] = ordered[number - 1]
    for match in _PART_REF_RE.finditer(text):
        label = (match.group(1) or match.group(2)).lower()
        for q in reversed(earlier):
            lead = _LEADING_PART_RE.match(q.question_text)
            same_group = question.group_id is None or q.group_id == question.group_id
            if same_group and ((q.part_label or "").lower() == label or (lead and lead.group(1).lower() == label)):
                found[q.id] = q
                break
    if _PREVIOUS_RE.search(text):
        found[earlier[-1].id] = earlier[-1]
    position = {q.id: i for i, q in enumerate(ordered)}
    return sorted(found.values(), key=lambda q: position[q.id])[-_MAX_RELATED:]


def related_context(
    question: Question,
    ordered: list[Question],
    answers: dict[int, str],
    verdicts: dict[int, bool],
) -> str:
    """The earlier questions, the student's answers and (for earlier parts of
    the same problem, which are graded first) their verdicts."""
    position = {q.id: i for i, q in enumerate(ordered)}
    entries: list[str] = []
    for q in related_questions(question, ordered):
        same_group = question.group_id is not None and q.group_id == question.group_id
        label = f"Question {position[q.id] + 1}"
        if q.group_id is not None and q.part_label:
            label += f", part ({q.part_label})"
        answer = (answers.get(q.id) or "").strip() or "(no answer)"
        if len(answer) > _RELATED_ANSWER_CHARS:
            answer = answer[:_RELATED_ANSWER_CHARS] + " ..."
        entry = f"{label}: {q.question_text if same_group else full_question_text(q)}\nStudent's answer: {answer}"
        if same_group and q.id in verdicts:
            entry += f"\nGraded: {'correct' if verdicts[q.id] else 'wrong'}"
        entries.append(entry)
    return "\n\n".join(entries)


def _drawn_answer(work: Optional[OcrResult]) -> str:
    """What a draw-only answer is stored and shown as: the working alone when
    the reader trimmed it, else the whole transcript (GH #157)."""
    if work is None:
        return ""
    return work.answer_work or work.transcript or ""


def _context_answer(typed: str, transcript: Optional[str]) -> str:
    typed = (typed or "").strip()
    transcript = (transcript or "").strip()
    if is_read_from_drawing(typed, transcript):
        typed = ""
    if transcript and transcript != typed:
        return f"{typed}\nShown work: {transcript}" if typed else transcript
    return typed


def _grading_lanes(pairs: list) -> list[list]:
    """Each multi-part problem is one lane graded in order; every other
    question is a lane of its own. Lanes grade in parallel."""
    lanes: list[list] = []
    by_group: dict[int, list] = {}
    for pair in sorted(pairs, key=lambda p: p[0].display_order):
        group_id = pair[0].group_id
        if group_id is None:
            lanes.append([pair])
        elif group_id in by_group:
            by_group[group_id].append(pair)
        else:
            by_group[group_id] = [pair]
            lanes.append(by_group[group_id])
    return lanes


class GradingService:
    def __init__(self, llm_service: Optional[LLMService] = None) -> None:
        self.llm_service = llm_service or LLMService()
        self.ocr_service = OcrService()

    async def submit_and_grade(
        self,
        test_id: int,
        user_id: int,
        answers: list[SubmittedAnswer],
        session: AsyncSession,
        ocr_engine: Optional[str] = None,
    ) -> AttemptResult:
        test = await TestRepository(session).get_owned_with_questions(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        question_by_id = {question.id: question for question in test.questions}
        submitted_by_id = {answer.question_id: answer for answer in answers}
        if not submitted_by_id:
            raise ValidationException("At least one answer is required")

        for question_id in submitted_by_id:
            if question_by_id.get(question_id) is None:
                raise ValidationException(f"Question {question_id} does not belong to this test")

        repo = AttemptRepository(session)
        # Delete any in-progress draft so it doesn't inflate the attempt number.
        # Its strokes are read first: a drawing OCR cannot read is kept on the
        # graded answer so the student can fix it on Results (GH #149).
        draft = await repo.get_draft(user_id, test_id)
        draft_strokes: dict[int, str] = {}
        if draft is not None:
            draft_strokes = {a.question_id: a.work_strokes for a in draft.answers if a.work_strokes}
            await session.delete(draft)
            await session.flush()
        attempt_number = await repo.next_attempt_number(user_id, test_id)
        attempt = await repo.create(user_id, test_id, attempt_number)
        notes = "\n\n".join(note.content for note in test.notes)

        is_math_mode = getattr(test, "is_math_mode", False)
        is_coding_mode = getattr(test, "is_coding_mode", False)
        coding_language = getattr(test, "coding_language", None) or "Python"

        # Transcribe any scratch-pad drawings first, bounded by a semaphore so
        # a submission with several drawings does not fire unbounded
        # concurrent vision calls. A drawing with no work.image never reaches
        # this loop at all (no ink, no cost): see ocr-routing.md.
        ocr_semaphore = asyncio.Semaphore(_OCR_CONCURRENCY)
        work_by_question_id: dict[int, Optional[OcrResult]] = {}

        async def _transcribe_one(question_id: int, image_b64: str) -> None:
            async with ocr_semaphore:
                work_by_question_id[question_id] = await self._transcribe(question_id, image_b64, ocr_engine)

        drawings = [
            (qid, ans.work_image) for qid, ans in submitted_by_id.items() if ans.work_image
        ]
        if drawings:
            await asyncio.gather(*(_transcribe_one(qid, image) for qid, image in drawings))

        # A drawing OCR could not read, or read with low legibility, is held
        # for the student to fix on Results instead of being graded as if it
        # were never sent (GH #149). Only where the drawing decides the grade.
        needs_input: set[int] = {
            qid
            for qid, ans in submitted_by_id.items()
            if ans.work_image
            and self._drawing_matters(question_by_id[qid], ans.answer, is_math_mode, is_coding_mode)
            and not self._readable(work_by_question_id.get(qid))
        }

        # A needs_input answer is not graded at all yet: no LLM spend on it.
        pairs = [(question_by_id[qid], ans) for qid, ans in submitted_by_id.items()]

        # Each question sees the earlier questions it builds on (GH #155).
        # Parts of one problem grade in order so a later part also sees the
        # earlier parts' verdicts; everything else still grades in parallel.
        ordered = list(test.questions)
        context_answers: dict[int, str] = {}
        for qid, ans in submitted_by_id.items():
            work = work_by_question_id.get(qid)
            context_answers[qid] = (
                _UNREADABLE_CONTEXT if qid in needs_input
                else _context_answer(ans.answer, work.transcript if work else None)
            )
        verdicts: dict[int, bool] = {}

        async def _grade_or_hold(question: Question, submitted: SubmittedAnswer) -> Optional[FRQGrade]:
            if question.id in needs_input:
                return None
            work = work_by_question_id.get(question.id)
            grade = await self._grade_question(
                question,
                self._answer_for_grading(question, submitted.answer, work, is_math_mode, is_coding_mode),
                notes,
                is_math_mode=is_math_mode,
                is_coding_mode=is_coding_mode,
                coding_language=coding_language,
                work=work,
                related=related_context(question, ordered, context_answers, verdicts),
            )
            verdicts[question.id] = grade.is_correct
            return grade

        async def _grade_lane(lane: list) -> list[Optional[FRQGrade]]:
            return [await _grade_or_hold(q, ans) for q, ans in lane]

        lanes = _grading_lanes(pairs)
        lane_grades = await asyncio.gather(*(_grade_lane(lane) for lane in lanes))
        grade_by_id = {
            q.id: grade for lane, graded in zip(lanes, lane_grades) for (q, _), grade in zip(lane, graded)
        }
        grades = [grade_by_id[q.id] for q, _ in pairs]

        results: list[AnswerResult] = []
        correct_count = 0
        for (question, submitted), grade in zip(pairs, grades):
            # Read from work_by_question_id directly, not grade.work_transcript:
            # grade_math_answer echoes it back, but MCQ/TF/MS/RANK/coding
            # grading never touches `work`, so relying on the grade result
            # alone would silently drop the transcript (and the OCR call that
            # produced it) for every non-math-FRQ question type, even though
            # the scratch pad is available on all of them.
            question_work = work_by_question_id.get(question.id)
            work_transcript = (question_work.transcript or None) if question_work else None
            if grade is None:
                # Held (needs_input): the typed text alone is stored, so a
                # later skip can grade it without the drawing.
                strokes = draft_strokes.get(question.id)
                await repo.add_answer(
                    attempt.id, question.id, submitted.answer, False, None, None, False,
                    work_strokes=strokes,
                    work_transcript=work_transcript,
                    ocr_status=OCR_STATUS_NEEDS_INPUT,
                )
                results.append(self._to_answer_result(
                    question,
                    user_answer=submitted.answer,
                    is_correct=False,
                    is_math=is_math_mode and question.question_type == "FRQ",
                    work_transcript=work_transcript,
                    ocr_status=OCR_STATUS_NEEDS_INPUT,
                    work_strokes=strokes,
                ))
                continue
            if grade.is_correct:
                correct_count += 1
            # A draw-only answer (empty typed text) is persisted as its
            # transcript, so it is not stored as an empty string and Results
            # has something to show for "your answer".
            user_answer = submitted.answer or _drawn_answer(question_work)
            ocr_status = OCR_STATUS_OK if submitted.work_image else None
            await repo.add_answer(
                attempt.id,
                question.id,
                user_answer,
                grade.is_correct,
                grade.feedback,
                grade.confidence,
                grade.flagged_uncertain,
                reasoning=grade.reasoning,
                work_transcript=work_transcript,
                ocr_status=ocr_status,
            )
            results.append(self._to_answer_result(
                question,
                user_answer=user_answer,
                is_correct=grade.is_correct,
                feedback=grade.feedback,
                reasoning=grade.reasoning,
                confidence=grade.confidence,
                flagged_uncertain=grade.flagged_uncertain,
                is_math=is_math_mode and question.question_type == "FRQ",
                work_transcript=work_transcript,
                ocr_status=ocr_status,
            ))

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
            is_provisional=bool(needs_input),
        )

    # ── OCR redo on Results (GH #149) ─────────────────────────────────────

    async def _transcribe(
        self, question_id: int, image_b64: str, ocr_engine: Optional[str]
    ) -> Optional[OcrResult]:
        try:
            return await asyncio.wait_for(
                self.ocr_service.transcribe(image_b64, engine=ocr_engine),
                timeout=_OCR_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            # OCR failure must never lose a submission: the answer is held for
            # the student (or graded without the drawing), never an error.
            logger.warning("Scratch-pad OCR failed for question %s: %s", question_id, exc)
            return None

    @staticmethod
    def _readable(work: Optional[OcrResult]) -> bool:
        return bool(work and work.transcript and work.confidence >= OCR_LOW_CONFIDENCE_THRESHOLD)

    @staticmethod
    def _drawing_matters(question: Question, typed: str, is_math_mode: bool, is_coding_mode: bool) -> bool:
        """Whether a bad read of this drawing would change the grade.

        A draw-only answer is graded from the drawing. A math FRQ grades the
        shown work alongside the typed answer. Anything else answered by
        typing or picking an option is graded on that alone, so a bad read is
        simply ignored.
        """
        if not typed.strip():
            return True
        return is_math_mode and not is_coding_mode and question.question_type == "FRQ"

    @staticmethod
    def _answer_for_grading(
        question: Question,
        typed: str,
        work: Optional[OcrResult],
        is_math_mode: bool,
        is_coding_mode: bool,
    ) -> str:
        """The text a question is graded on.

        Math FRQ grading reads the shown work itself (grade_math_answer is told
        when nothing was typed). Every other grader only sees this string, so a
        draw-only answer there is graded on its transcript, not on "".
        """
        if typed.strip() or work is None:
            return typed
        if is_math_mode and not is_coding_mode and question.question_type == "FRQ":
            return typed
        return work.transcript

    def _to_answer_result(
        self,
        question: Optional[Question],
        *,
        question_id: Optional[int] = None,
        user_answer: str,
        is_correct: bool,
        feedback: Optional[str] = None,
        reasoning: Optional[str] = None,
        confidence: Optional[float] = None,
        flagged_uncertain: bool = False,
        is_math: bool = False,
        work_transcript: Optional[str] = None,
        ocr_status: Optional[str] = None,
        work_strokes: Optional[str] = None,
    ) -> AnswerResult:
        """One AnswerResult, with the answer key redacted while needs_input.

        A held answer's correct answer, feedback and reasoning must never reach
        the client before the redo, or the student could copy the key into it.
        """
        held = ocr_status == OCR_STATUS_NEEDS_INPUT
        group = question.__dict__.get("group") if question is not None else None
        return AnswerResult(
            question_id=question.id if question is not None else int(question_id or 0),
            question_text=question.question_text if question is not None else None,
            user_answer=user_answer,
            correct_answer=None if held or question is None else self._correct_answer_text(question),
            is_correct=is_correct,
            feedback=None if held else feedback,
            reasoning=None if held else reasoning,
            confidence=None if held else confidence,
            flagged_uncertain=False if held else flagged_uncertain,
            is_math=is_math,
            work_transcript=work_transcript,
            answer_inferred=bool(question.answer_inferred) if question is not None else False,
            ocr_status=ocr_status,
            work_strokes=work_strokes if held else None,
            group_id=group.id if group is not None else None,
            group_label=group.label if group is not None else None,
            group_stem=group.stem if group is not None else None,
            part_label=question.part_label if group is not None else None,
        )

    async def _load_held_answer(self, attempt_id: int, user_id: int, session: AsyncSession):
        attempt = await session.scalar(
            select(UserAttempt).where(UserAttempt.id == attempt_id, UserAttempt.user_id == user_id)
        )
        if attempt is None or attempt.status != "submitted":
            raise ResourceNotFoundException("Attempt")
        test = await TestRepository(session).get_owned_with_questions(attempt.test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        return attempt, test

    async def _rescore(self, attempt, session: AsyncSession) -> tuple[float, int, int, bool]:
        """Recompute the attempt's score in place from its answer rows."""
        answers = await AttemptRepository(session).list_answers(attempt.id)
        total = attempt.total_questions or len(answers)
        correct = sum(1 for a in answers if a.is_correct)
        score = round((correct / total) * 100, 2) if total else 0.0
        attempt.correct_count = correct
        attempt.total_score = score
        provisional = any(a.ocr_status == OCR_STATUS_NEEDS_INPUT for a in answers)
        return score, correct, total, provisional

    async def redo_answer(
        self,
        attempt_id: int,
        question_id: int,
        user_id: int,
        body: RedoAnswerRequest,
        session: AsyncSession,
        ocr_engine: Optional[str] = None,
    ) -> RedoAnswerResponse:
        """The student's one redo of a held answer: transcribe, grade, rescore.

        One redo only: the answer leaves needs_input whatever happens, so a
        second call is refused. A drawing still unreadable is graded without
        it (typed answer if any, else blank); a low-legibility read is graded
        with grade_math_answer's own low-confidence caveat rather than held
        again.
        """
        attempt, test = await self._load_held_answer(attempt_id, user_id, session)
        question = next((q for q in test.questions if q.id == question_id), None)
        repo = AttemptRepository(session)
        row = await repo.get_answer(attempt.id, question_id)
        if question is None or row is None:
            raise ResourceNotFoundException("Answer")
        if row.ocr_status != OCR_STATUS_NEEDS_INPUT:
            raise ValidationException("This answer is not waiting for a redo")

        is_math_mode = getattr(test, "is_math_mode", False)
        is_coding_mode = getattr(test, "is_coding_mode", False)
        work = await self._transcribe(question_id, body.work_image, ocr_engine) if body.work_image else None
        if work is not None and not work.transcript:
            work = None

        if not body.answer and work is None:
            grade = FRQGrade(
                is_correct=False,
                feedback="We still couldn't read your drawing, so this answer was graded as blank.",
                confidence=0.0,
            )
        else:
            notes = "\n\n".join(note.content for note in test.notes)
            answers, verdicts = await self._stored_context(attempt.id, session)
            grade = await self._grade_question(
                question,
                self._answer_for_grading(question, body.answer, work, is_math_mode, is_coding_mode),
                notes,
                is_math_mode=is_math_mode,
                is_coding_mode=is_coding_mode,
                coding_language=getattr(test, "coding_language", None) or "Python",
                work=work,
                related=related_context(question, list(test.questions), answers, verdicts),
            )

        work_transcript = work.transcript if work is not None else row.work_transcript
        row.user_answer = body.answer or _drawn_answer(work)
        row.is_correct = grade.is_correct
        row.ai_feedback = grade.feedback
        row.ai_reasoning = grade.reasoning
        row.confidence_score = grade.confidence
        row.flagged_uncertain = grade.flagged_uncertain
        row.work_transcript = work_transcript
        row.work_strokes = None
        row.ocr_status = OCR_STATUS_RESOLVED
        await session.flush()
        later = await self._regrade_later_parts(test, attempt.id, {question_id}, session)
        score, correct, total, provisional = await self._rescore(attempt, session)
        await session.commit()

        return RedoAnswerResponse(
            attempt_id=attempt.id,
            score=score,
            correct_count=correct,
            total=total,
            is_provisional=provisional,
            answers=[self._to_answer_result(
                question,
                user_answer=row.user_answer,
                is_correct=grade.is_correct,
                feedback=grade.feedback,
                reasoning=grade.reasoning,
                confidence=grade.confidence,
                flagged_uncertain=grade.flagged_uncertain,
                is_math=is_math_mode and question.question_type == "FRQ",
                work_transcript=work_transcript,
                ocr_status=OCR_STATUS_RESOLVED,
            )] + later,
        )

    async def _stored_context(self, attempt_id: int, session: AsyncSession) -> tuple[dict[int, str], dict[int, bool]]:
        """Answers and verdicts as stored, for regrading with related context."""
        answers: dict[int, str] = {}
        verdicts: dict[int, bool] = {}
        for row in await AttemptRepository(session).list_answers(attempt_id):
            if row.ocr_status == OCR_STATUS_NEEDS_INPUT:
                answers[row.question_id] = _UNREADABLE_CONTEXT
                continue
            answers[row.question_id] = _context_answer(row.user_answer, row.work_transcript)
            verdicts[row.question_id] = bool(row.is_correct)
        return answers, verdicts

    async def _regrade_later_parts(
        self, test, attempt_id: int, changed_ids: set[int], session: AsyncSession
    ) -> list[AnswerResult]:
        """After a held part is redone or skipped, the later written parts of
        its problem were graded without knowing it: regrade them in order
        (GH #155). Objective parts are graded on their own and stay as they are.
        """
        ordered = list(test.questions)
        changed = [q for q in ordered if q.id in changed_ids and q.group_id is not None]
        if not changed or getattr(test, "is_coding_mode", False):
            return []
        is_math_mode = getattr(test, "is_math_mode", False)
        notes = "\n\n".join(note.content for note in test.notes)
        repo = AttemptRepository(session)
        answers, verdicts = await self._stored_context(attempt_id, session)
        results: list[AnswerResult] = []
        for group_id in dict.fromkeys(q.group_id for q in changed):
            parts = [q for q in ordered if q.group_id == group_id]
            first = min(i for i, q in enumerate(parts) if q.id in changed_ids)
            for question in parts[first + 1:]:
                if question.id in changed_ids or question.question_type != "FRQ":
                    continue
                row = await repo.get_answer(attempt_id, question.id)
                if row is None or row.ocr_status == OCR_STATUS_NEEDS_INPUT:
                    continue
                transcript = (row.work_transcript or "").strip()
                typed = "" if is_read_from_drawing(row.user_answer, transcript) else row.user_answer
                work = OcrResult(transcript=transcript, confidence=1.0, engine="stored") if transcript else None
                grade = await self._grade_question(
                    question,
                    self._answer_for_grading(question, typed, work, is_math_mode, False),
                    notes,
                    is_math_mode=is_math_mode,
                    work=work,
                    related=related_context(question, ordered, answers, verdicts),
                )
                verdicts[question.id] = grade.is_correct
                row.is_correct = grade.is_correct
                row.ai_feedback = grade.feedback
                row.ai_reasoning = grade.reasoning
                row.confidence_score = grade.confidence
                row.flagged_uncertain = grade.flagged_uncertain
                results.append(self._to_answer_result(
                    question,
                    user_answer=row.user_answer,
                    is_correct=grade.is_correct,
                    feedback=grade.feedback,
                    reasoning=grade.reasoning,
                    confidence=grade.confidence,
                    flagged_uncertain=grade.flagged_uncertain,
                    is_math=is_math_mode and question.question_type == "FRQ",
                    work_transcript=row.work_transcript,
                    ocr_status=row.ocr_status,
                ))
        await session.flush()
        return results

    async def skip_unreadable(
        self,
        attempt_id: int,
        user_id: int,
        question_ids: list[int],
        session: AsyncSession,
    ) -> RedoAnswerResponse:
        """Grade held answers without their drawing. Empty question_ids = all.

        A held answer with typed text is graded on that text alone; one with
        nothing typed is graded as blank (no LLM call).
        """
        attempt, test = await self._load_held_answer(attempt_id, user_id, session)
        question_by_id = {q.id: q for q in test.questions}
        repo = AttemptRepository(session)
        wanted = set(question_ids)
        rows = [
            a for a in await repo.list_answers(attempt.id)
            if a.ocr_status == OCR_STATUS_NEEDS_INPUT and (not wanted or a.question_id in wanted)
        ]
        is_math_mode = getattr(test, "is_math_mode", False)
        is_coding_mode = getattr(test, "is_coding_mode", False)
        notes = "\n\n".join(note.content for note in test.notes)

        async def _grade(row) -> FRQGrade:
            question = question_by_id.get(row.question_id)
            if question is None or not row.user_answer.strip():
                return FRQGrade(
                    is_correct=False,
                    feedback="Skipped. Your drawing couldn't be read, so this answer was graded as blank.",
                    confidence=0.0,
                )
            return await self._grade_question(
                question, row.user_answer, notes,
                is_math_mode=is_math_mode,
                is_coding_mode=is_coding_mode,
                coding_language=getattr(test, "coding_language", None) or "Python",
                work=None,
            )

        grades = await asyncio.gather(*(_grade(row) for row in rows))
        results: list[AnswerResult] = []
        for row, grade in zip(rows, grades):
            row.is_correct = grade.is_correct
            row.ai_feedback = grade.feedback
            row.ai_reasoning = grade.reasoning
            row.confidence_score = grade.confidence
            row.flagged_uncertain = grade.flagged_uncertain
            row.work_strokes = None
            row.ocr_status = OCR_STATUS_SKIPPED
            question = question_by_id.get(row.question_id)
            results.append(self._to_answer_result(
                question,
                question_id=row.question_id,
                user_answer=row.user_answer,
                is_correct=grade.is_correct,
                feedback=grade.feedback,
                reasoning=grade.reasoning,
                confidence=grade.confidence,
                flagged_uncertain=grade.flagged_uncertain,
                is_math=bool(question and is_math_mode and question.question_type == "FRQ"),
                work_transcript=row.work_transcript,
                ocr_status=OCR_STATUS_SKIPPED,
            ))
        await session.flush()
        results += await self._regrade_later_parts(test, attempt.id, {row.question_id for row in rows}, session)
        score, correct, total, provisional = await self._rescore(attempt, session)
        await session.commit()
        return RedoAnswerResponse(
            attempt_id=attempt.id,
            score=score,
            correct_count=correct,
            total=total,
            is_provisional=provisional,
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
        work: Optional[OcrResult] = None,
        related: str = "",
    ) -> FRQGrade:
        qtype = question.question_type

        # Objective types are graded deterministically, then enriched with an LLM
        # "how to solve / why it's correct" guide (for both correct and incorrect
        # answers). The deterministic feedback stays as the fallback if the LLM call
        # fails or there is no configured answer.
        if qtype in ("MCQ", "TF", "MS", "RANK"):
            if qtype == "MS":
                grade = self._grade_ms(question, user_answer)
            elif qtype == "RANK":
                grade = self._grade_rank(question, user_answer)
            else:
                grade = self._grade_mcq(question, user_answer)
            return await self._enrich_objective_feedback(question, user_answer, grade)

        # FRQ grading (existing logic)
        if question.frq_answer is None:
            return FRQGrade(
                is_correct=False,
                feedback="This FRQ has no expected answer configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        expected_answer = question.frq_answer.expected_answer
        if question.answer_inferred:
            # No answer key backs this one (GH #133): a correct answer that
            # differs from Nosey's own reference must not be marked wrong.
            expected_answer = (
                f"{expected_answer}\n\n(This reference answer was worked out by Nosey, not taken from "
                "an answer key. Treat it as a guide: if the student's answer is correct on its own "
                "merits, mark it correct even where it differs.)"
            )
        if is_coding_mode:
            return await self.llm_service.grade_code_answer(
                question=full_question_text(question),
                expected_answer=expected_answer,
                user_code=user_answer,
                language=coding_language,
            )
        if is_math_mode:
            return await self.llm_service.grade_math_answer(
                question=full_question_text(question),
                expected_answer=expected_answer,
                user_answer=user_answer,
                work=work,
                related_context=related,
            )
        return await self.llm_service.grade_frq_answer(
            notes=notes,
            question=full_question_text(question),
            expected_answer=expected_answer,
            user_answer=user_answer,
            related_context=related,
        )

    async def _enrich_objective_feedback(
        self,
        question: Question,
        user_answer: str,
        grade: FRQGrade,
    ) -> FRQGrade:
        """Replace the plain deterministic feedback with an LLM-written guide, and
        sanity-check the stored answer key against the LLM's own judgement.

        Skips the LLM call when there is no configured correct answer (the grade
        already carries a config-error message). On LLM failure, keeps the original
        deterministic feedback.

        Answer-key correction: the stored key is occasionally a generation-time
        hallucination. When the LLM is confident the key is wrong, we correct only in
        the student's favour (flip incorrect -> correct when they picked the option the
        LLM believes is truly correct) and never take points away based on the LLM,
        which can itself be wrong. Any disagreement sets flagged_uncertain so the
        Results page can surface a "this grade may be off" warning.
        """
        correct_answer = self._correct_answer_text(question)
        if not correct_answer:
            return grade

        options = [o.option_text for o in question.mcq_options] or None
        result = await self.llm_service.explain_objective_answer(
            question=full_question_text(question),
            correct_answer=correct_answer,
            user_answer=user_answer,
            is_correct=grade.is_correct,
            options=options,
        )
        if not result.feedback:
            return grade

        is_correct = grade.is_correct
        flagged_uncertain = grade.flagged_uncertain

        # The LLM thinks the stored answer key is wrong. Surface it, and restore the
        # point if the student actually picked the option the LLM believes is correct.
        if not result.answer_key_ok and result.actual_correct_answer:
            flagged_uncertain = True
            # Only single-answer types (MCQ/TF) have an unambiguous "did the student
            # pick the truly-correct option" check. MS/RANK stay flagged only.
            if not is_correct and question.question_type in ("MCQ", "TF"):
                chosen = self._resolve_chosen_option(question, user_answer)
                llm_correct = result.actual_correct_answer.strip().lower()
                if chosen is not None and chosen.option_text.strip().lower() == llm_correct:
                    is_correct = True

        return FRQGrade(
            is_correct=is_correct,
            feedback=result.feedback,
            reasoning=result.reasoning,
            flagged_uncertain=flagged_uncertain,
            confidence=grade.confidence,
        )

    def _resolve_chosen_option(self, question: Question, user_answer: str):
        """Resolve a student's MCQ/TF answer to the MCQOption they selected.

        Mirrors the matching logic in _grade_mcq: accepts either the option text or a
        single letter (a/b/c...). Returns None when nothing matches.
        """
        normalized = user_answer.strip().lower()
        for option in question.mcq_options:
            if option.option_text.strip().lower() == normalized:
                return option
        letter_index = (
            ord(normalized[0]) - ord("a")
            if len(normalized) == 1 and normalized.isalpha()
            else -1
        )
        if 0 <= letter_index < len(question.mcq_options):
            return question.mcq_options[letter_index]
        return None

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

    def _grade_ms(self, question: Question, user_answer: str) -> FRQGrade:
        """Multiple Select (all-or-nothing): selected set must exactly equal correct set.

        user_answer is a JSON array of the selected option texts. Correct options are
        the MCQOption rows with is_correct=True. Comparison is case/whitespace-insensitive.
        """
        correct = {o.option_text.strip().lower() for o in question.mcq_options if o.is_correct}
        if not correct:
            return FRQGrade(
                is_correct=False,
                feedback="This question has no correct selections configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        try:
            parsed = json.loads(user_answer)
            selected = {str(item).strip().lower() for item in parsed} if isinstance(parsed, list) else set()
        except (json.JSONDecodeError, ValueError, TypeError):
            selected = {user_answer.strip().lower()} if user_answer.strip() else set()

        is_correct = selected == correct
        feedback = None
        if not is_correct:
            correct_labels = " | ".join(o.option_text for o in question.mcq_options if o.is_correct)
            feedback = f"The correct selections were: {correct_labels}"
        return FRQGrade(is_correct=is_correct, feedback=feedback, flagged_uncertain=False, confidence=1.0)

    def _grade_rank(self, question: Question, user_answer: str) -> FRQGrade:
        """Ranking (all-or-nothing): submitted order must exactly match the correct order.

        The correct order is the MCQOption rows sorted by display_order (the relationship
        is already ordered that way). user_answer is a JSON array of the option texts in
        the student's chosen order.
        """
        correct_order = [o.option_text.strip().lower() for o in question.mcq_options]
        if not correct_order:
            return FRQGrade(
                is_correct=False,
                feedback="This question has no ordering configured.",
                flagged_uncertain=True,
                confidence=0.0,
            )
        try:
            parsed = json.loads(user_answer)
            user_order = [str(item).strip().lower() for item in parsed] if isinstance(parsed, list) else []
        except (json.JSONDecodeError, ValueError, TypeError):
            return FRQGrade(
                is_correct=False,
                feedback="Could not read your ordering.",
                flagged_uncertain=False,
                confidence=0.5,
            )

        is_correct = user_order == correct_order
        feedback = None
        if not is_correct:
            feedback = "Correct order: " + " → ".join(o.option_text for o in question.mcq_options)
        return FRQGrade(is_correct=is_correct, feedback=feedback, flagged_uncertain=False, confidence=1.0)

    def _correct_answer_text(self, question: Question) -> Optional[str]:
        qtype = question.question_type

        # MCQ / True-False / Multiple-Select: show the correct option(s).
        if qtype in ("MCQ", "TF", "MS"):
            correct = [o for o in question.mcq_options if o.is_correct]
            if correct:
                return " | ".join(o.option_text for o in correct)
            return None

        # Ranking: show the correct sequence (options are stored in display_order order).
        if qtype == "RANK":
            if question.mcq_options:
                return " → ".join(o.option_text for o in question.mcq_options)
            return None

        if question.frq_answer is not None:
            return question.frq_answer.expected_answer

        return None

    async def list_attempts(
        self, test_id: int, user_id: int, session: AsyncSession
    ) -> list[AttemptSummary]:
        # Ownership check only: the history list needs no questions or notes, and
        # loading them (full note text included) made the history toggle slow.
        test = await TestRepository(session).get_owned(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        repo = AttemptRepository(session)
        attempts = await repo.list_for_test(user_id, test_id)
        provisional = await repo.provisional_attempt_ids([attempt.id for attempt in attempts])
        return [
            AttemptSummary(
                id=attempt.id,
                attempt_number=attempt.attempt_number,
                score=float(attempt.total_score or 0),
                correct_count=attempt.correct_count or 0,
                total=attempt.total_questions or 0,
                created_at=attempt.created_at,
                is_provisional=attempt.id in provisional,
            )
            for attempt in attempts
        ]

    async def get_attempt_detail(
        self, attempt_id: int, user_id: int, session: AsyncSession
    ) -> AttemptDetail:
        repo = AttemptRepository(session)
        attempt = await repo.get_detail(attempt_id, user_id)
        if attempt is None:
            raise ResourceNotFoundException("Attempt")
        held = any(answer.ocr_status == OCR_STATUS_NEEDS_INPUT for answer in attempt.answers)
        pending_strokes = await repo.get_pending_strokes(attempt.id) if held else {}
        is_math_mode = bool(attempt.test and getattr(attempt.test, "is_math_mode", False))
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
                self._to_answer_result(
                    answer.question,
                    question_id=answer.question_id,
                    user_answer=answer.user_answer,
                    is_correct=bool(answer.is_correct),
                    feedback=answer.ai_feedback,
                    reasoning=answer.ai_reasoning,
                    confidence=float(answer.confidence_score)
                    if answer.confidence_score is not None
                    else None,
                    flagged_uncertain=answer.flagged_uncertain,
                    is_math=bool(is_math_mode and answer.question and answer.question.question_type == "FRQ"),
                    work_transcript=answer.work_transcript,
                    ocr_status=answer.ocr_status,
                    work_strokes=pending_strokes.get(answer.question_id),
                )
                for answer in attempt.answers
            ],
            is_provisional=held,
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

        question_ids = {question.id for question in test.questions}
        for answer in answers:
            if answer.question_id not in question_ids:
                raise ValidationException(f"Question {answer.question_id} does not belong to this test")

        # Locks the draft row so overlapping autosaves apply one at a time.
        repo = AttemptRepository(session)
        attempt = await repo.get_or_create_draft(user_id, test_id)
        # Scratch-pad strokes are only ever written here (STEM Scratch Pad).
        await repo.sync_draft_answers(
            attempt.id,
            {answer.question_id: (answer.user_answer, answer.work_strokes) for answer in answers},
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
            DraftAttemptAnswer(
                question_id=ans.question_id,
                user_answer=ans.user_answer,
                work_strokes=ans.work_strokes,
            )
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
