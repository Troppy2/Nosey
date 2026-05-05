from __future__ import annotations

import json
from sqlalchemy import Select, func, select
from sqlalchemy.orm import selectinload

from src.models.fill_blank_answer import FillBlankAnswer
from src.models.frq_answer import FRQAnswer
from src.models.folder import Folder
from src.models.matching_answer import MatchingAnswer
from src.models.mcq_option import MCQOption
from src.models.note import Note
from src.models.ordering_answer import OrderingAnswer
from src.models.question import Question
from src.models.select_all_answer import SelectAllAnswer
from src.models.test import Test
from src.models.user_attempt import UserAttempt
from src.repositories.base_repository import BaseRepository
from typing import Optional

_QUESTION_WITH_ANSWERS = (
    selectinload(Question.mcq_options),
    selectinload(Question.frq_answer),
    selectinload(Question.matching_answer),
    selectinload(Question.ordering_answer),
    selectinload(Question.fill_blank_answer),
    selectinload(Question.select_all_answer),
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
    ) -> Test:
        test = Test(
            folder_id=folder_id,
            title=title,
            test_type=test_type,
            description=description,
            is_math_mode=is_math_mode,
            is_coding_mode=is_coding_mode,
            coding_language=coding_language,
        )
        self.session.add(test)
        await self.session.flush()
        return test

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
        self, test_id: int, text: str, display_order: int, options: list[tuple[str, bool]]
    ) -> Question:
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="MCQ",
            display_order=display_order,
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

    async def add_frq_question(
        self, test_id: int, text: str, display_order: int, expected_answer: str
    ) -> Question:
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="FRQ",
            display_order=display_order,
        )
        self.session.add(question)
        await self.session.flush()
        self.session.add(FRQAnswer(question_id=question.id, expected_answer=expected_answer))
        return question

    async def add_matching_question(
        self, test_id: int, text: str, display_order: int, pairs: list[dict[str, str]]
    ) -> Question:
        """Create a matching question with term-definition pairs."""
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="matching",
            display_order=display_order,
        )
        self.session.add(question)
        await self.session.flush()
        self.session.add(
            MatchingAnswer(question_id=question.id, pairs_json=json.dumps(pairs))
        )
        return question

    async def add_ordering_question(
        self, test_id: int, text: str, display_order: int, correct_order: list[str]
    ) -> Question:
        """Create an ordering question with a correct sequence."""
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="ordering",
            display_order=display_order,
        )
        self.session.add(question)
        await self.session.flush()
        self.session.add(
            OrderingAnswer(question_id=question.id, correct_order_json=json.dumps(correct_order))
        )
        return question

    async def add_fill_blank_question(
        self, test_id: int, text: str, display_order: int, acceptable_answers: list[str]
    ) -> Question:
        """Create a fill-in-the-blank question with acceptable answers."""
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="fill_blank",
            display_order=display_order,
        )
        self.session.add(question)
        await self.session.flush()
        self.session.add(
            FillBlankAnswer(
                question_id=question.id,
                acceptable_answers_json=json.dumps(acceptable_answers)
            )
        )
        return question

    async def add_select_all_question(
        self, test_id: int, text: str, display_order: int, options: list[tuple[str, bool]], correct_indices: list[int]
    ) -> Question:
        """Create a select-all question with multiple correct options."""
        question = Question(
            test_id=test_id,
            question_text=text,
            question_type="select_all",
            display_order=display_order,
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
        self.session.add(
            SelectAllAnswer(
                question_id=question.id,
                correct_indices_json=json.dumps(correct_indices)
            )
        )
        return question

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

