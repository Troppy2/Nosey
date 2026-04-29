from __future__ import annotations

from sqlalchemy import Select, func, select
from sqlalchemy.orm import selectinload

from src.models.frq_answer import FRQAnswer
from src.models.folder import Folder
from src.models.mcq_option import MCQOption
from src.models.note import Note
from src.models.question import Question
from src.models.test import Test
from src.models.user_attempt import UserAttempt
from src.repositories.base_repository import BaseRepository


class TestRepository(BaseRepository[Test]):
    async def create(self, folder_id: int, title: str, test_type: str, description: str | None) -> Test:
        test = Test(folder_id=folder_id, title=title, test_type=test_type, description=description)
        self.session.add(test)
        await self.session.flush()
        return test

    async def get_owned(self, test_id: int, user_id: int) -> Test | None:
        stmt = select(Test).join(Folder, Folder.id == Test.folder_id).where(
            Test.id == test_id,
            Folder.user_id == user_id,
        )
        return await self.session.scalar(stmt)

    async def get_with_questions(self, test_id: int) -> Test | None:
        stmt = (
            select(Test)
            .where(Test.id == test_id)
            .options(
                selectinload(Test.questions).selectinload(Question.mcq_options),
                selectinload(Test.questions).selectinload(Question.frq_answer),
                selectinload(Test.notes),
            )
        )
        return await self.session.scalar(stmt)

    async def get_owned_with_questions(self, test_id: int, user_id: int) -> Test | None:
        stmt = (
            select(Test)
            .join(Folder, Folder.id == Test.folder_id)
            .where(Test.id == test_id, Folder.user_id == user_id)
            .options(
                selectinload(Test.questions).selectinload(Question.mcq_options),
                selectinload(Test.questions).selectinload(Question.frq_answer),
                selectinload(Test.notes),
            )
        )
        return await self.session.scalar(stmt)

    async def list_by_folder(self, folder_id: int, user_id: int) -> list[tuple[Test, int, float | None, int]]:
        stmt: Select[tuple[Test, int, float | None, int]] = (
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

    async def list_by_user(self, user_id: int) -> list[tuple[Test, int, float | None, int]]:
        stmt: Select[tuple[Test, int, float | None, int]] = (
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

    async def delete(self, test: Test) -> None:
        await self.session.delete(test)

