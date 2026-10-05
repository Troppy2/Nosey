from __future__ import annotations

from sqlalchemy import Select, func, select
from sqlalchemy.orm import selectinload

from src.models.frq_answer import FRQAnswer
from src.models.folder import Folder
from src.models.mcq_option import MCQOption
from src.models.note import Note
from src.models.question import Question
from src.models.question_group import QuestionGroup
from src.models.test import Test
from src.models.user_attempt import UserAttempt
from src.repositories.base_repository import BaseRepository
from typing import Optional

_QUESTION_WITH_ANSWERS = (
    selectinload(Question.mcq_options),
    selectinload(Question.frq_answer),
    # Multi-part problems (GH #151): the setup every LLM call needs with a part.
    selectinload(Question.group),
)


class TestRepository(BaseRepository[Test]):
    async def create(
        self,
        folder_id: int,
        title: str,
        test_type: str,
        description: Optional[str],
        is_math_mode: bool = False,
        is_coding_mode: bool = False,
        coding_language: Optional[str] = None,
        notes_hash: Optional[str] = None,
    ) -> Test:
        test = Test(
            folder_id=folder_id,
            title=title,
            test_type=test_type,
            description=description,
            is_math_mode=is_math_mode,
            is_coding_mode=is_coding_mode,
            coding_language=coding_language,
            notes_hash=notes_hash,
        )
        self.session.add(test)
        await self.session.flush()
        return test

    async def get_prior_question_texts(
        self,
        folder_id: int,
        notes_hash: str,
        exclude_test_id: int,
        limit: int = 80,
    ) -> list[str]:
        """Return question texts from earlier READY tests in this folder that were
        built from the SAME source notes (matched by notes_hash). Used to tell the
        LLM which questions the student has already seen so it can avoid repeating
        them. Capped at `limit` (most recent tests first) to protect the token budget.
        """
        stmt = (
            select(Question.question_text)
            .join(Test, Test.id == Question.test_id)
            .where(
                Test.folder_id == folder_id,
                Test.notes_hash == notes_hash,
                Test.id != exclude_test_id,
                Test.generation_status == "ready",
            )
            .order_by(Test.created_at.desc(), Question.display_order)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return [text for text in result.scalars().all() if text and text.strip()]

    async def get_owned(self, test_id: int, user_id: int) -> Optional[Test]:
        stmt = select(Test).join(Folder, Folder.id == Test.folder_id).where(
            Test.id == test_id,
            Folder.user_id == user_id,
        )
        return await self.session.scalar(stmt)

    async def get_with_questions(self, test_id: int) -> Optional[Test]:
        stmt = (
            select(Test)
            .where(Test.id == test_id)
            .options(
                selectinload(Test.questions).options(*_QUESTION_WITH_ANSWERS),
                selectinload(Test.notes),
            )
        )
        return await self.session.scalar(stmt)

    async def get_owned_with_questions(self, test_id: int, user_id: int) -> Optional[Test]:
        stmt = (
            select(Test)
            .join(Folder, Folder.id == Test.folder_id)
            .where(Test.id == test_id, Folder.user_id == user_id)
            .options(
                selectinload(Test.questions).options(*_QUESTION_WITH_ANSWERS),
                selectinload(Test.notes),
                selectinload(Test.folder),
            )
        )
        return await self.session.scalar(stmt)

    async def list_by_folder(self, folder_id: int, user_id: int) -> list[tuple[Test, int, Optional[float], int]]:
        stmt: Select[tuple[Test, int, Optional[float], int]] = (
            select(
                Test,
                func.count(func.distinct(Question.id)).label("question_count"),
                func.max(UserAttempt.total_score).label("best_score"),
                func.count(func.distinct(UserAttempt.id)).label("attempt_count"),
            )
            .join(Test.folder)
            .outerjoin(Question, Question.test_id == Test.id)
            .outerjoin(
                UserAttempt,
                (UserAttempt.test_id == Test.id) & (UserAttempt.user_id == user_id),
            )
            .where(Test.folder_id == folder_id, Folder.user_id == user_id)
            .group_by(Test.id)
            .order_by(Test.created_at.desc())
        )
        rows = await self.session.execute(stmt)
        return list(rows.all())

    async def list_by_user(self, user_id: int) -> list[tuple[Test, int, Optional[float], int]]:
        stmt: Select[tuple[Test, int, Optional[float], int]] = (
            select(
                Test,
                func.count(func.distinct(Question.id)).label("question_count"),
                func.max(UserAttempt.total_score).label("best_score"),
                func.count(func.distinct(UserAttempt.id)).label("attempt_count"),
            )
            .join(Test.folder)
            .outerjoin(Question, Question.test_id == Test.id)
            .outerjoin(
                UserAttempt,
                (UserAttempt.test_id == Test.id) & (UserAttempt.user_id == user_id),
            )
            .where(Folder.user_id == user_id)
            .group_by(Test.id)
            .order_by(Test.created_at.desc())
        )
        rows = await self.session.execute(stmt)
        return list(rows.all())

    async def add_note(self, test_id: int, file_name: str, file_type: str, content: str) -> Note:
        note = Note(test_id=test_id, file_name=file_name, file_type=file_type, content=content)
        self.session.add(note)
        await self.session.flush()
        return note

    async def add_mcq_question(
        self,
        test_id: int,
        text: str,
        display_order: int,
        options: list[tuple[str, bool]],
        answer_inferred: bool = False,
        group_id: Optional[int] = None,
        part_label: Optional[str] = None,
    ) -> Question:
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="MCQ",
            display_order=display_order,
            answer_inferred=answer_inferred,
            group_id=group_id,
            part_label=part_label,
        )
        self.session.add(question)
        await self.session.flush()
        for index, (option_text, is_correct) in enumerate(options, start=1):
            self.session.add(
                MCQOption(
                    question_id=question.id,
                    option_text=option_text,
                    is_correct=is_correct,
                    display_order=index,
                )
            )
        return question

    async def add_tf_question(
        self, test_id: int, text: str, display_order: int, correct_answer: bool
    ) -> Question:
        """True/False: stored as two MCQOptions ("True"/"False"), one marked correct."""
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="TF",
            display_order=display_order,
        )
        self.session.add(question)
        await self.session.flush()
        self.session.add(MCQOption(question_id=question.id, option_text="True", is_correct=correct_answer, display_order=1))
        self.session.add(MCQOption(question_id=question.id, option_text="False", is_correct=not correct_answer, display_order=2))
        return question

    async def add_ms_question(
        self, test_id: int, text: str, display_order: int, options: list[tuple[str, bool]]
    ) -> Question:
        """Multiple Select: MCQOptions with one OR MORE marked correct."""
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="MS",
            display_order=display_order,
        )
        self.session.add(question)
        await self.session.flush()
        for index, (option_text, is_correct) in enumerate(options, start=1):
            self.session.add(
                MCQOption(question_id=question.id, option_text=option_text, is_correct=is_correct, display_order=index)
            )
        return question

    async def add_rank_question(
        self, test_id: int, text: str, display_order: int, items_in_correct_order: list[str]
    ) -> Question:
        """Ranking: MCQOptions whose display_order ENCODES the correct sequence.

        The student-facing serializer shuffles these before sending them out, so the
        correct order (display_order ascending) is never revealed to the student.
        """
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="RANK",
            display_order=display_order,
        )
        self.session.add(question)
        await self.session.flush()
        for index, item_text in enumerate(items_in_correct_order, start=1):
            self.session.add(
                MCQOption(question_id=question.id, option_text=item_text, is_correct=False, display_order=index)
            )
        return question

    async def add_frq_question(
        self,
        test_id: int,
        text: str,
        display_order: int,
        expected_answer: str,
        answer_inferred: bool = False,
        group_id: Optional[int] = None,
        part_label: Optional[str] = None,
    ) -> Question:
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="FRQ",
            display_order=display_order,
            answer_inferred=answer_inferred,
            group_id=group_id,
            part_label=part_label,
        )
        self.session.add(question)
        await self.session.flush()
        self.session.add(FRQAnswer(question_id=question.id, expected_answer=expected_answer))
        return question

    async def add_question_group(self, test_id: int, label: str, stem: str) -> QuestionGroup:
        """One multi-part problem's shared setup (GH #151), after the test's last group."""
        last = await self.session.scalar(
            select(func.coalesce(func.max(QuestionGroup.display_order), 0)).where(QuestionGroup.test_id == test_id)
        )
        group = QuestionGroup(test_id=test_id, label=label[:50], stem=stem, display_order=int(last or 0) + 1)
        self.session.add(group)
        await self.session.flush()
        return group

    async def delete(self, test: Test) -> None:
        await self.session.delete(test)

    async def get_questions_for_editing(self, test_id: int, user_id: int) -> list[Question]:
        stmt = (
            select(Question)
            .join(Test, Test.id == Question.test_id)
            .join(Folder, Folder.id == Test.folder_id)
            .where(Test.id == test_id, Folder.user_id == user_id)
            .options(*_QUESTION_WITH_ANSWERS)
            .order_by(Question.display_order)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_question_owned(self, question_id: int, user_id: int) -> Optional[Question]:
        stmt = (
            select(Question)
            .join(Test, Test.id == Question.test_id)
            .join(Folder, Folder.id == Test.folder_id)
            .where(Question.id == question_id, Folder.user_id == user_id)
            .options(*_QUESTION_WITH_ANSWERS)
        )
        return await self.session.scalar(stmt)

    async def get_group_owned(self, group_id: int, test_id: int, user_id: int) -> Optional[QuestionGroup]:
        stmt = (
            select(QuestionGroup)
            .join(Test, Test.id == QuestionGroup.test_id)
            .join(Folder, Folder.id == Test.folder_id)
            .where(QuestionGroup.id == group_id, QuestionGroup.test_id == test_id, Folder.user_id == user_id)
        )
        return await self.session.scalar(stmt)

    async def get_max_display_order(self, test_id: int) -> int:
        result = await self.session.scalar(
            select(func.max(Question.display_order)).where(Question.test_id == test_id)
        )
        return int(result) if result is not None else 0

    async def update_mcq_options(self, question: Question, options: list[tuple[str, bool]]) -> None:
        for opt in list(question.mcq_options):
            await self.session.delete(opt)
        await self.session.flush()
        for index, (option_text, is_correct) in enumerate(options, start=1):
            self.session.add(MCQOption(
                question_id=question.id,
                option_text=option_text,
                is_correct=is_correct,
                display_order=index,
            ))

    async def delete_question(self, question: Question) -> None:
        await self.session.delete(question)



async def add_generated_questions(repo: TestRepository, test_id: int, mcq: list, frq: list, start_order: int) -> int:
    """Write generated MCQ/FRQ items; return the next display_order.

    Items with a document order (seq, recreated practice tests) are written in
    that order across both types, so a problem's parts stay together, and each
    multi-part problem gets one QuestionGroup holding its setup (GH #151).
    Items without seq keep the old order: every MCQ, then every FRQ. Groups are
    matched within this one call only; every practice path persists its
    questions in a single call.
    """
    items: list[tuple[str, object]] = [("mcq", q) for q in mcq] + [("frq", q) for q in frq]
    if any(getattr(q, "seq", None) is not None for _, q in items):
        unordered = max((q.seq for _, q in items if getattr(q, "seq", None) is not None), default=0) + 1
        items = sorted(items, key=lambda pair: pair[1].seq if pair[1].seq is not None else unordered)
    group_ids: dict[str, int] = {}
    display_order = start_order
    for kind, item in items:
        group_key = getattr(item, "group_key", None)
        part_label = getattr(item, "part_label", None)
        group_id: Optional[int] = None
        if group_key and part_label:
            if group_key not in group_ids:
                group = await repo.add_question_group(test_id, item.group_label or "", item.group_stem or "")
                group_ids[group_key] = group.id
            group_id = group_ids[group_key]
        grouping = {"group_id": group_id, "part_label": part_label} if group_id is not None else {}
        if kind == "mcq":
            options = [(text, index == item.correct_index) for index, text in enumerate(item.options)]
            await repo.add_mcq_question(
                test_id, item.question_text, display_order, options,
                answer_inferred=item.answer_inferred, **grouping,
            )
        else:
            await repo.add_frq_question(
                test_id, item.question_text, display_order, item.expected_answer,
                answer_inferred=item.answer_inferred, **grouping,
            )
        display_order += 1
    return display_order
