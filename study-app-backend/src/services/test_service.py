from __future__ import annotations

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.folder_repository import FolderRepository
from src.repositories.test_repository import TestRepository
from src.schemas.test_schema import (
    CreateTestResponse,
    MCQOptionPublic,
    QuestionPublic,
    TestResponse,
    TestSummary,
    TestTakeResponse,
    TestUpdate,
)
from src.services.file_service import FileService
from src.services.llm_service import LLMService
from src.utils.exceptions import ResourceNotFoundException, ValidationException
from src.utils.validators import VALID_TEST_TYPES


class TestService:
    def __init__(
        self,
        llm_service: LLMService | None = None,
        file_service: FileService | None = None,
    ) -> None:
        self.llm_service = llm_service or LLMService()
        self.file_service = file_service or FileService()

    async def create_test(
        self,
        folder_id: int,
        user_id: int,
        title: str,
        test_type: str,
        notes_files: list[UploadFile],
        session: AsyncSession,
        description: str | None = None,
    ) -> CreateTestResponse:
        if test_type not in VALID_TEST_TYPES:
            raise ValidationException("test_type must be MCQ_only, FRQ_only, or mixed")
        if not notes_files:
            raise ValidationException("At least one notes document is required")
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        notes_content, file_types = await self.file_service.extract_from_files(notes_files)
        repo = TestRepository(session)
        test = await repo.create(folder_id, title, test_type, description)
        await repo.add_note(
            test.id,
            ", ".join(notes_file.filename or "notes" for notes_file in notes_files),
            ",".join(file_types),
            notes_content,
        )

        mcq_questions, frq_questions = await self.llm_service.generate_test_questions(
            notes=notes_content,
            test_type=test_type,
            count_mcq=10,
            count_frq=5,
        )
        display_order = 1
        for item in mcq_questions:
            options = [
                (option_text, index == item.correct_index)
                for index, option_text in enumerate(item.options)
            ]
            await repo.add_mcq_question(test.id, item.question_text, display_order, options)
            display_order += 1
        for item in frq_questions:
            await repo.add_frq_question(test.id, item.question_text, display_order, item.expected_answer)
            display_order += 1

        await session.commit()
        return CreateTestResponse(
            test_id=test.id,
            title=test.title,
            questions_generated=len(mcq_questions) + len(frq_questions),
        )

    async def list_tests(
        self, folder_id: int, user_id: int, session: AsyncSession
    ) -> list[TestSummary]:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        rows = await TestRepository(session).list_by_folder(folder_id, user_id)
        return [
            TestSummary(
                id=test.id,
                title=test.title,
                description=test.description,
                test_type=test.test_type,
                question_count=question_count,
                best_score=float(best_score) if best_score is not None else None,
                attempt_count=attempt_count,
                created_at=test.created_at,
            )
            for test, question_count, best_score, attempt_count in rows
        ]

    async def list_tests_for_user(self, user_id: int, session: AsyncSession) -> list[TestSummary]:
        rows = await TestRepository(session).list_by_user(user_id)
        return [
            TestSummary(
                id=test.id,
                title=test.title,
                description=test.description,
                test_type=test.test_type,
                question_count=question_count,
                best_score=float(best_score) if best_score is not None else None,
                attempt_count=attempt_count,
                created_at=test.created_at,
            )
            for test, question_count, best_score, attempt_count in rows
        ]

    async def get_test_for_taking(
        self, test_id: int, user_id: int, session: AsyncSession
    ) -> TestTakeResponse:
        test = await TestRepository(session).get_owned_with_questions(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        questions = [
            QuestionPublic(
                id=question.id,
                type=question.question_type,
                question_text=question.question_text,
                options=[
                    MCQOptionPublic(id=option.id, text=option.option_text)
                    for option in question.mcq_options
                ],
            )
            for question in test.questions
        ]
        return TestTakeResponse(
            id=test.id,
            title=test.title,
            description=test.description,
            test_type=test.test_type,
            questions=questions,
        )

    async def update_test(
        self, test_id: int, user_id: int, data: TestUpdate, session: AsyncSession
    ) -> TestResponse:
        test = await TestRepository(session).get_owned(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        if data.title is not None:
            test.title = data.title
        if data.description is not None:
            test.description = data.description
        await session.commit()
        await session.refresh(test)
        return TestResponse.model_validate(test)

    async def delete_test(self, test_id: int, user_id: int, session: AsyncSession) -> None:
        test = await TestRepository(session).get_owned(test_id, user_id)
        if test is None:
            raise ResourceNotFoundException("Test")
        await TestRepository(session).delete(test)
        await session.commit()
