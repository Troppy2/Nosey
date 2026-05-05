from __future__ import annotations

import json
import random
from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.folder_repository import FolderRepository
from src.repositories.test_repository import TestRepository
from src.schemas.test_schema import (
    CreateTestResponse,
    MatchingPair,
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
from typing import Optional


class TestService:
    def __init__(
        self,
        llm_service: Optional[LLMService] = None,
        file_service: Optional[FileService] = None,
    ) -> None:
        self.llm_service = llm_service or LLMService()
        self.file_service = file_service or FileService()

    def _summarize_note_file_name(self, filenames: list[str], fallback: str) -> str:
        names = [name.strip() for name in filenames if name and name.strip()]
        if not names:
            return fallback[:255]
        if len(names) == 1:
            return names[0][:255]
        summary = f"{names[0]} (+{len(names) - 1} more)"
        return summary[:255]

    def _summarize_note_file_type(self, file_types: list[str], fallback: str) -> str:
        types = [file_type.strip().lower() for file_type in file_types if file_type and file_type.strip()]
        if not types:
            return fallback[:10]

        unique_types = list(dict.fromkeys(types))
        if len(unique_types) == 1:
            return unique_types[0][:10]

        if all(file_type in {"pdf", "txt", "md", "docx"} for file_type in unique_types):
            return "mixed"

        return "uploaded"[:10]

    def _serialize_question_editable(self, q) -> QuestionEditable:
        qtype = q.question_type
        if qtype == "MCQ":
            return QuestionEditable(
                id=q.id, type="MCQ", question_text=q.question_text,
                options=[MCQOptionEditable(id=opt.id, text=opt.option_text, is_correct=opt.is_correct) for opt in q.mcq_options],
            )
        if qtype == "select_all":
            return QuestionEditable(
                id=q.id, type="select_all", question_text=q.question_text,
                options=[MCQOptionEditable(id=opt.id, text=opt.option_text, is_correct=opt.is_correct) for opt in q.mcq_options],
            )
        if qtype == "matching" and q.matching_answer:
            pairs = json.loads(q.matching_answer.pairs_json)
            return QuestionEditable(
                id=q.id, type="matching", question_text=q.question_text,
                matching_pairs=[MatchingPair(left=p["left"], right=p["right"]) for p in pairs],
            )
        if qtype == "ordering" and q.ordering_answer:
            items = json.loads(q.ordering_answer.correct_order_json)
            return QuestionEditable(id=q.id, type="ordering", question_text=q.question_text, ordering_items=items)
        if qtype == "fill_blank" and q.fill_blank_answer:
            acceptable = json.loads(q.fill_blank_answer.acceptable_answers_json)
            return QuestionEditable(
                id=q.id, type="fill_blank", question_text=q.question_text,
                expected_answer=acceptable[0] if acceptable else None,
            )
        return QuestionEditable(
            id=q.id, type=qtype or "FRQ", question_text=q.question_text,
            expected_answer=q.frq_answer.expected_answer if q.frq_answer else None,
        )

    def _serialize_question_public(self, q) -> QuestionPublic:
        qtype = q.question_type
        if qtype in ("MCQ", "select_all"):
            return QuestionPublic(
                id=q.id, type=qtype, question_text=q.question_text,
                options=[MCQOptionPublic(id=opt.id, text=opt.option_text) for opt in q.mcq_options],
            )
        if qtype == "matching" and q.matching_answer:
            pairs = json.loads(q.matching_answer.pairs_json)
            shuffled = pairs[:]
            random.shuffle(shuffled)
            return QuestionPublic(
                id=q.id, type=qtype, question_text=q.question_text,
                matching_pairs=[MatchingPair(left=p["left"], right=p["right"]) for p in shuffled],
            )
        if qtype == "ordering" and q.ordering_answer:
            items = json.loads(q.ordering_answer.correct_order_json)
            shuffled = items[:]
            random.shuffle(shuffled)
            return QuestionPublic(id=q.id, type=qtype, question_text=q.question_text, ordering_items=shuffled)
        # fill_blank and FRQ: question_text only
        return QuestionPublic(id=q.id, type=qtype or "FRQ", question_text=q.question_text)

    async def create_test(
        self,
        folder_id: int,
        user_id: int,
        title: str,
        test_type: str,
        notes_files: list[UploadFile],
        session: AsyncSession,
        description: Optional[str] = None,
        count_mcq: int = 10,
        count_frq: int = 5,
        practice_test_file: Optional[UploadFile] = None,
        is_math_mode: bool = False,
        difficulty: str = "mixed",
        topic_focus: Optional[str] = None,
        is_coding_mode: bool = False,
        coding_language: Optional[str] = None,
        custom_instructions: Optional[str] = None,
        provider: Optional[str] = None,
        beta_enabled: bool = False,
        enable_fallback: bool = True,
        question_types: Optional[list[str]] = None,
    ) -> CreateTestResponse:
        if test_type not in VALID_TEST_TYPES:
            raise ValidationException("test_type must be MCQ_only, FRQ_only, mixed, or Extreme")
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        if test_type == "Extreme":
            count_frq = 0

        active_provider = provider

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

        # Determine if we have study content (notes + folder files)
        has_study_content = bool(notes_files or folder_files_content)

        # If the user uploaded notes on the generate-test page, use only those notes.
        # Folder-level study files are still available when no notes were uploaded.
        use_folder_files = not notes_files
        
        selected_question_types = [qtype for qtype in (question_types or []) if qtype in {"matching", "ordering", "fill_blank", "select_all"}]

        if practice_test_file is not None and has_study_content:
            # CASE 1: Practice test as TEMPLATE + Study content
            # Generate NEW questions that model the practice test style but use study notes as source
            pt_content, pt_file_types = await self.file_service.extract_from_files([practice_test_file])
            practice_test_name = self._summarize_note_file_name(
                [practice_test_file.filename or "practice_test_template"],
                "practice_test_template",
            )
            
            # Store the practice test for reference
            await repo.add_note(
                test.id,
                practice_test_name,
                self._summarize_note_file_type(pt_file_types, "practice"),
                pt_content,
            )
            
            # Combine all study content
            context_parts: list[str] = []
            context_labels: list[str] = []
            file_types: list[str] = []
            if notes_files:
                notes_content, file_types = await self.file_service.extract_from_files(notes_files)
                context_parts.append(notes_content)
                context_labels.append(", ".join(f.filename or "notes" for f in notes_files))
            if use_folder_files and folder_files_content:
                context_parts.append(folder_files_content)
                context_labels.append("stored folder files")
                if "combined" not in file_types:
                    file_types.append("combined")
            
            combined_study_content = "\n\n---\n\n".join(context_parts).strip()
            
            # Store study content for grading reference
            await repo.add_note(
                test.id,
                self._summarize_note_file_name(context_labels, "study context"),
                self._summarize_note_file_type(file_types, "combined"),
                combined_study_content,
            )
            
            # Generate questions using practice test as template
            mcq_questions, frq_questions = await self.llm_service.generate_from_practice_test_template(
                notes=combined_study_content,
                practice_test_content=pt_content,
                test_type=test_type,
                count_mcq=count_mcq if test_type != "FRQ_only" else 0,
                count_frq=count_frq if test_type != "MCQ_only" else 0,
                is_math_mode=is_math_mode,
                difficulty=difficulty,
                topic_focus=topic_focus,
                is_coding_mode=is_coding_mode,
                coding_language=coding_language,
                custom_instructions=custom_instructions,
                provider=active_provider,
                enable_fallback=enable_fallback,
            )
            beta_source_notes = combined_study_content
            generation_meta = {}
            try:
                meta_candidate = self.llm_service.get_last_generation_meta()
                if isinstance(meta_candidate, dict):
                    generation_meta = meta_candidate
            except Exception:
                generation_meta = {}
        elif practice_test_file is not None:
            # CASE 2: Practice test only (no study content) - EXTRACT questions from test
            pt_content, pt_file_types = await self.file_service.extract_from_files([practice_test_file])
            await repo.add_note(
                test.id,
                self._summarize_note_file_name([practice_test_file.filename or "practice_test"], "practice_test"),
                self._summarize_note_file_type(pt_file_types, "practice"),
                pt_content,
            )
            
            mcq_questions, frq_questions = await self.llm_service.parse_practice_test(
                content=pt_content,
                count_mcq=count_mcq if test_type != "FRQ_only" else 0,
                count_frq=count_frq if test_type != "MCQ_only" else 0,
                provider=active_provider,
            )
            beta_source_notes = pt_content
            generation_meta: dict[str, object] = {
                "fallback_used": False,
                "fallback_reason": None,
                "note_grounded": True,
                "retrieval_enabled": False,
                "retrieval_total_chunks": 0,
                "retrieval_selected_chunks": 0,
                "retrieval_top_k": 0,
            }
        else:
            # CASE 3: Normal test generation from study content only
            context_parts: list[str] = []
            context_labels: list[str] = []
            file_types: list[str] = []
            if notes_files:
                notes_content, file_types = await self.file_service.extract_from_files(notes_files)
                context_parts.append(notes_content)
                context_labels.append(", ".join(f.filename or "notes" for f in notes_files))
            else:
                notes_content = ""
            if use_folder_files and folder_files_content:
                context_parts.append(folder_files_content)
                context_labels.append("stored folder files")
                file_types.append("combined")
            notes_content = "\n\n---\n\n".join(context_parts).strip()
            await repo.add_note(
                test.id,
                self._summarize_note_file_name(context_labels, "study context"),
                self._summarize_note_file_type(file_types, "combined"),
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
                custom_instructions=custom_instructions,
                provider=active_provider,
                enable_fallback=enable_fallback,
            )
            beta_source_notes = notes_content
            generation_meta = {}
            try:
                meta_candidate = self.llm_service.get_last_generation_meta()
                if isinstance(meta_candidate, dict):
                    generation_meta = meta_candidate
            except Exception:
                generation_meta = {}

        matching_questions = []
        ordering_questions = []
        fill_blank_questions = []
        select_all_questions = []
        if beta_enabled and selected_question_types:
            matching_questions, ordering_questions, fill_blank_questions, select_all_questions = await self.llm_service.generate_beta_questions(
                notes=beta_source_notes,
                question_types=selected_question_types,
                provider=active_provider,
                enable_fallback=enable_fallback,
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
        for item in matching_questions:
            await repo.add_matching_question(test.id, item.question_text, display_order, item.pairs)
            display_order += 1
        for item in ordering_questions:
            await repo.add_ordering_question(test.id, item.question_text, display_order, item.correct_order)
            display_order += 1
        for item in fill_blank_questions:
            await repo.add_fill_blank_question(test.id, item.question_text, display_order, item.acceptable_answers)
            display_order += 1
        for item in select_all_questions:
            options = [(option_text, index in item.correct_indices) for index, option_text in enumerate(item.options)]
            await repo.add_select_all_question(test.id, item.question_text, display_order, options, item.correct_indices)
            display_order += 1

        await session.commit()
        fallback_used = bool(generation_meta.get("fallback_used", False))
        fallback_reason = generation_meta.get("fallback_reason")
        message = "Test created. Ready to take."
        if fallback_used:
            message = "Test created with fallback questions because the LLM output was unavailable or invalid."
        return CreateTestResponse(
            test_id=test.id,
            title=test.title,
            questions_generated=len(mcq_questions) + len(frq_questions),
            message=message,
            fallback_used=fallback_used,
            fallback_reason=str(fallback_reason) if fallback_reason else None,
            note_grounded=bool(generation_meta.get("note_grounded", not fallback_used)),
            retrieval_enabled=bool(generation_meta.get("retrieval_enabled", False)),
            retrieval_total_chunks=int(generation_meta.get("retrieval_total_chunks", 0) or 0),
            retrieval_selected_chunks=int(generation_meta.get("retrieval_selected_chunks", 0) or 0),
            retrieval_top_k=int(generation_meta.get("retrieval_top_k", 0) or 0),
        )

    async def get_questions_for_editing(
        self, test_id: int, user_id: int, session: AsyncSession
    ) -> list[QuestionEditable]:
        questions = await TestRepository(session).get_questions_for_editing(test_id, user_id)
        return [self._serialize_question_editable(q) for q in questions]

    async def update_question(
        self, question_id: int, user_id: int, data: QuestionUpdate, session: AsyncSession
    ) -> QuestionEditable:
        repo = TestRepository(session)
        question = await repo.get_question_owned(question_id, user_id)
        if question is None:
            raise ResourceNotFoundException("Question")
        if data.question_text is not None:
            question.question_text = data.question_text
        qtype = question.question_type
        if qtype == "MCQ" and data.options is not None:
            if len(data.options) != 4:
                raise ValidationException("MCQ questions must have exactly 4 options")
            correct_count = sum(1 for o in data.options if o.is_correct)
            if correct_count != 1:
                raise ValidationException("Exactly one option must be marked correct")
            await repo.update_mcq_options(question, [(o.text, o.is_correct) for o in data.options])
        elif qtype == "select_all" and data.options is not None:
            await repo.update_mcq_options(question, [(o.text, o.is_correct) for o in data.options])
        elif qtype == "matching" and data.matching_pairs is not None and question.matching_answer is not None:
            question.matching_answer.pairs_json = json.dumps(
                [{"left": p.left, "right": p.right} for p in data.matching_pairs]
            )
        elif qtype == "ordering" and data.ordering_items is not None and question.ordering_answer is not None:
            question.ordering_answer.correct_order_json = json.dumps(data.ordering_items)
        elif qtype == "fill_blank" and data.expected_answer is not None and question.fill_blank_answer is not None:
            question.fill_blank_answer.acceptable_answers_json = json.dumps([data.expected_answer])
        elif qtype == "FRQ" and data.expected_answer is not None and question.frq_answer is not None:
            question.frq_answer.expected_answer = data.expected_answer
        await session.commit()
        refreshed = await repo.get_question_owned(question.id, user_id)
        assert refreshed is not None
        return self._serialize_question_editable(refreshed)

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
                [(o.text, o.is_correct) for o in data.options],
            )
        elif data.type == "FRQ":
            if not data.expected_answer:
                raise ValidationException("FRQ questions require an expected_answer")
            question = await repo.add_frq_question(
                test_id, data.question_text, display_order, data.expected_answer
            )
        elif data.type == "matching":
            if not data.matching_pairs:
                raise ValidationException("Matching questions require at least one pair")
            question = await repo.add_matching_question(
                test_id, data.question_text, display_order,
                [{"left": p.left, "right": p.right} for p in data.matching_pairs],
            )
        elif data.type == "ordering":
            if not data.ordering_items:
                raise ValidationException("Ordering questions require at least one item")
            question = await repo.add_ordering_question(test_id, data.question_text, display_order, data.ordering_items)
        elif data.type == "fill_blank":
            if not data.expected_answer:
                raise ValidationException("Fill-in-the-blank questions require an expected_answer")
            question = await repo.add_fill_blank_question(test_id, data.question_text, display_order, [data.expected_answer])
        elif data.type == "select_all":
            if len(data.options) < 2:
                raise ValidationException("Select-all questions require at least 2 options")
            if not any(o.is_correct for o in data.options):
                raise ValidationException("At least one option must be marked correct")
            correct_indices = [i for i, o in enumerate(data.options) if o.is_correct]
            question = await repo.add_select_all_question(
                test_id, data.question_text, display_order,
                [(o.text, o.is_correct) for o in data.options], correct_indices,
            )
        else:
            raise ValidationException("type must be MCQ, FRQ, matching, ordering, fill_blank, or select_all")
        await session.commit()
        refreshed = await repo.get_question_owned(question.id, user_id)
        assert refreshed is not None
        return self._serialize_question_editable(refreshed)

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
        questions = [self._serialize_question_public(q) for q in test.questions]
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
