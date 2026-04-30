from __future__ import annotations

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.folder_repository import FolderRepository
from src.repositories.test_repository import TestRepository
from src.schemas.test_schema import (
    CreateTestResponse,
    MCQOptionEditable,
    MCQOptionPublic,
    QuestionCreate,
    QuestionEditable,
    QuestionPublic,
    QuestionUpdate,
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
        count_mcq: int = 10,
        count_frq: int = 5,
        practice_test_file: UploadFile | None = None,
        is_math_mode: bool = False,
        difficulty: str = "mixed",
        topic_focus: str | None = None,
        is_coding_mode: bool = False,
        coding_language: str | None = None,
    ) -> CreateTestResponse:
        if test_type not in VALID_TEST_TYPES:
            raise ValidationException("test_type must be MCQ_only, FRQ_only, or mixed")
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        folder_files_content = await self.file_service.get_folder_files_content(folder_id, session)
        if not notes_files and practice_test_file is None and not folder_files_content:
            raise ValidationException(
                "At least one notes document, folder file, or a practice test file is required"
            )

        repo = TestRepository(session)
        test = await repo.create(
            folder_id, title, test_type, description,
            is_math_mode=is_math_mode,
            is_coding_mode=is_coding_mode,
            coding_language=coding_language,
        )

        if practice_test_file is not None:
            # Practice test mode: extract questions directly from the uploaded test doc
            pt_content, pt_file_types = await self.file_service.extract_from_files([practice_test_file])
            await repo.add_note(
                test.id,
                practice_test_file.filename or "practice_test",
                ",".join(pt_file_types),
                pt_content,
            )
            # Also store any accompanying notes files or folder files for grading context
            context_parts: list[str] = []
            context_labels: list[str] = []
            if notes_files:
                notes_content, notes_file_types = await self.file_service.extract_from_files(notes_files)
                context_parts.append(notes_content)
                context_labels.append(", ".join(f.filename or "notes" for f in notes_files))
                await repo.add_note(
                    test.id,
                    ", ".join(f.filename or "notes" for f in notes_files),
                    ",".join(notes_file_types),
                    notes_content,
                )
            if folder_files_content:
                context_parts.append(folder_files_content)
                context_labels.append("stored folder files")
            if context_parts:
                await repo.add_note(
                    test.id,
                    ", ".join(context_labels) if context_labels else "study context",
                    "combined",
                    "\n\n---\n\n".join(context_parts),
                )
            mcq_questions, frq_questions = await self.llm_service.parse_practice_test(
                content=pt_content,
                count_mcq=count_mcq if test_type != "FRQ_only" else 0,
                count_frq=count_frq if test_type != "MCQ_only" else 0,
            )
        else:
            context_parts: list[str] = []
            context_labels: list[str] = []
            file_types: list[str] = []
            if notes_files:
                notes_content, file_types = await self.file_service.extract_from_files(notes_files)
                context_parts.append(notes_content)
                context_labels.append(", ".join(f.filename or "notes" for f in notes_files))
            else:
                notes_content = ""
            if folder_files_content:
                context_parts.append(folder_files_content)
                context_labels.append("stored folder files")
                file_types.append("combined")
            notes_content = "\n\n---\n\n".join(context_parts).strip()
            await repo.add_note(
                test.id,
                ", ".join(context_labels) if context_labels else "study context",
                ",".join(file_types) if file_types else "combined",
                notes_content,
            )
            mcq_questions, frq_questions = await self.llm_service.generate_test_questions(
                notes=notes_content,
                test_type=test_type,
                count_mcq=count_mcq,
                count_frq=count_frq,
                is_math_mode=is_math_mode,
                difficulty=difficulty,
                topic_focus=topic_focus,
                is_coding_mode=is_coding_mode,
                coding_language=coding_language,
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

    async def get_questions_for_editing(
        self, test_id: int, user_id: int, session: AsyncSession
    ) -> list[QuestionEditable]:
        questions = await TestRepository(session).get_questions_for_editing(test_id, user_id)
        result = []
        for q in questions:
            if q.question_type == "MCQ":
                result.append(QuestionEditable(
                    id=q.id,
                    type="MCQ",
                    question_text=q.question_text,
                    options=[
                        MCQOptionEditable(id=opt.id, text=opt.option_text, is_correct=opt.is_correct)
                        for opt in q.mcq_options
                    ],
                ))
            else:
                result.append(QuestionEditable(
                    id=q.id,
                    type="FRQ",
                    question_text=q.question_text,
                    options=[],
                    expected_answer=q.frq_answer.expected_answer if q.frq_answer else None,
                ))
        return result

    async def update_question(
        self, question_id: int, user_id: int, data: QuestionUpdate, session: AsyncSession
    ) -> QuestionEditable:
        repo = TestRepository(session)
        question = await repo.get_question_owned(question_id, user_id)
        if question is None:
            raise ResourceNotFoundException("Question")
        if data.question_text is not None:
            question.question_text = data.question_text
        if question.question_type == "MCQ" and data.options is not None:
            if len(data.options) != 4:
                raise ValidationException("MCQ questions must have exactly 4 options")
            correct_count = sum(1 for o in data.options if o.is_correct)
            if correct_count != 1:
                raise ValidationException("Exactly one option must be marked correct")
            await repo.update_mcq_options(question, [(o.text, o.is_correct) for o in data.options])
        if question.question_type == "FRQ" and data.expected_answer is not None:
            if question.frq_answer is not None:
                question.frq_answer.expected_answer = data.expected_answer
        await session.commit()
        await session.refresh(question)
        # Reload with options after commit
        refreshed = await repo.get_question_owned(question.id, user_id)
        assert refreshed is not None
        if refreshed.question_type == "MCQ":
            return QuestionEditable(
                id=refreshed.id,
                type="MCQ",
                question_text=refreshed.question_text,
                options=[
                    MCQOptionEditable(id=opt.id, text=opt.option_text, is_correct=opt.is_correct)
                    for opt in refreshed.mcq_options
                ],
            )
        return QuestionEditable(
            id=refreshed.id,
            type="FRQ",
            question_text=refreshed.question_text,
            options=[],
            expected_answer=refreshed.frq_answer.expected_answer if refreshed.frq_answer else None,
        )

    async def add_question(
        self, test_id: int, user_id: int, data: QuestionCreate, session: AsyncSession
    ) -> QuestionEditable:
        from src.models.question import Question as QuestionModel
        repo = TestRepository(session)
        # Verify the test belongs to the user
        from sqlalchemy import select
        from src.models.test import Test
        from src.models.folder import Folder
        stmt = (
            select(Test)
            .join(Folder, Folder.id == Test.folder_id)
            .where(Test.id == test_id, Folder.user_id == user_id)
        )
        test = await session.scalar(stmt)
        if test is None:
            raise ResourceNotFoundException("Test")
        display_order = await repo.get_max_display_order(test_id) + 1
        if data.type == "MCQ":
            if len(data.options) != 4:
                raise ValidationException("MCQ questions must have exactly 4 options")
            correct_count = sum(1 for o in data.options if o.is_correct)
            if correct_count != 1:
                raise ValidationException("Exactly one option must be marked correct")
            question = await repo.add_mcq_question(
                test_id, data.question_text, display_order,
                [(o.text, o.is_correct) for o in data.options]
            )
            await session.commit()
            refreshed = await repo.get_question_owned(question.id, user_id)
            assert refreshed is not None
            return QuestionEditable(
                id=refreshed.id,
                type="MCQ",
                question_text=refreshed.question_text,
                options=[
                    MCQOptionEditable(id=opt.id, text=opt.option_text, is_correct=opt.is_correct)
                    for opt in refreshed.mcq_options
                ],
            )
        elif data.type == "FRQ":
            if not data.expected_answer:
                raise ValidationException("FRQ questions require an expected_answer")
            question = await repo.add_frq_question(
                test_id, data.question_text, display_order, data.expected_answer
            )
            await session.commit()
            refreshed = await repo.get_question_owned(question.id, user_id)
            assert refreshed is not None
            return QuestionEditable(
                id=refreshed.id,
                type="FRQ",
                question_text=refreshed.question_text,
                options=[],
                expected_answer=refreshed.frq_answer.expected_answer if refreshed.frq_answer else None,
            )
        else:
            raise ValidationException("type must be MCQ or FRQ")

    async def delete_question(self, question_id: int, user_id: int, session: AsyncSession) -> None:
        repo = TestRepository(session)
        question = await repo.get_question_owned(question_id, user_id)
        if question is None:
            raise ResourceNotFoundException("Question")
        await repo.delete_question(question)
        await session.commit()

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
            is_math_mode=test.is_math_mode,
            is_coding_mode=test.is_coding_mode,
            coding_language=test.coding_language,
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
