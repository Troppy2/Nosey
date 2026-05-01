from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import UploadFile

from src.repositories.flashcard_repository import FlashcardRepository
from src.repositories.folder_repository import FolderRepository
from src.repositories.test_repository import TestRepository
from src.schemas.flashcard_schema import FlashcardCreate, FlashcardResponse, FlashcardUpdate
from src.services.file_service import FileService
from src.services.llm_service import LLMService
from src.utils.exceptions import ResourceNotFoundException, ValidationException
from typing import Optional


class FlashcardService:
    def __init__(self, llm_service: Optional[LLMService] = None, file_service: Optional[FileService] = None) -> None:
        self.llm_service = llm_service or LLMService()
        self.file_service = file_service or FileService()

    async def create_flashcard(
        self, folder_id: int, user_id: int, data: FlashcardCreate, session: AsyncSession
    ) -> FlashcardResponse:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        card = await FlashcardRepository(session).create(
            folder_id=folder_id,
            front=data.front,
            back=data.back,
            source=data.source,
        )
        await session.commit()
        await session.refresh(card)
        return FlashcardResponse.model_validate(card)

    async def generate_from_test(
        self,
        folder_id: int,
        test_id: int,
        user_id: int,
        count: int,
        session: AsyncSession,
        provider: Optional[str] = None,
    ) -> list[FlashcardResponse]:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        test = await TestRepository(session).get_owned_with_questions(test_id, user_id)
        if test is None or test.folder_id != folder_id:
            raise ResourceNotFoundException("Test")
        folder_files_content = await self.file_service.get_folder_files_content(folder_id, session)
        content = self._join_contexts(
            "\n\n".join(note.content for note in test.notes),
            folder_files_content,
        )
        existing_flashcards = await self._existing_flashcard_context(folder_id, user_id, session)
        generated = await self.llm_service.generate_flashcards(
            content=content,
            count=count,
            existing_flashcards=existing_flashcards,
            provider=provider,
        )
        repo = FlashcardRepository(session)
        cards = [
            await repo.create(folder_id, item.front, item.back, "generated_from_test")
            for item in generated
        ]
        await session.commit()
        return [FlashcardResponse.model_validate(card) for card in cards]

    async def generate_from_prompt(
        self,
        folder_id: int,
        user_id: int,
        prompt: str,
        count: int,
        session: AsyncSession,
        provider: Optional[str] = None,
    ) -> list[FlashcardResponse]:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        folder_files_content = await self.file_service.get_folder_files_content(folder_id, session)
        existing_flashcards = await self._existing_flashcard_context(folder_id, user_id, session)
        generated = await self.llm_service.generate_flashcards(
            content=folder_files_content,
            count=count,
            prompt=prompt,
            existing_flashcards=existing_flashcards,
            provider=provider,
        )
        repo = FlashcardRepository(session)
        cards = [
            await repo.create(folder_id, item.front, item.back, "generated_from_prompt")
            for item in generated
        ]
        await session.commit()
        return [FlashcardResponse.model_validate(card) for card in cards]

    async def list_flashcards(
        self, folder_id: int, user_id: int, session: AsyncSession
    ) -> list[FlashcardResponse]:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        rows = await FlashcardRepository(session).list_with_stats(folder_id, user_id)
        return [self._response_from_stats(*row) for row in rows]

    async def list_flashcards_for_user(
        self, user_id: int, session: AsyncSession
    ) -> list[FlashcardResponse]:
        rows = await FlashcardRepository(session).list_with_stats_for_user(user_id)
        return [self._response_from_stats(*row) for row in rows]

    async def record_attempt(
        self,
        folder_id: int,
        flashcard_id: int,
        user_id: int,
        correct: bool,
        time_ms: Optional[int],
        session: AsyncSession,
    ) -> FlashcardResponse:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        repo = FlashcardRepository(session)
        card = await repo.get(flashcard_id)
        if card is None or card.folder_id != folder_id:
            raise ResourceNotFoundException("Flashcard")
        await repo.record_attempt(user_id, flashcard_id, correct, time_ms)
        correct_count, attempt_count, success_rate = await repo.success_rate(user_id, flashcard_id)
        if success_rate >= 0.8:
            card.difficulty = max(1, card.difficulty - 1)
        elif success_rate < 0.4:
            card.difficulty = min(5, card.difficulty + 1)
        await session.commit()
        await session.refresh(card)
        return FlashcardResponse.model_validate(card).model_copy(
            update={
                "attempt_count": attempt_count,
                "correct_count": correct_count,
                "success_rate": round(success_rate, 2),
            }
        )

    async def update_flashcard(
        self, folder_id: int, flashcard_id: int, user_id: int, data: FlashcardUpdate, session: AsyncSession
    ) -> FlashcardResponse:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        repo = FlashcardRepository(session)
        card = await repo.get(flashcard_id)
        if card is None or card.folder_id != folder_id:
            raise ResourceNotFoundException("Flashcard")
        card = await repo.update(card, data.front, data.back)
        await session.commit()
        await session.refresh(card)
        return FlashcardResponse.model_validate(card)

    async def delete_flashcard(
        self, folder_id: int, flashcard_id: int, user_id: int, session: AsyncSession
    ) -> None:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        repo = FlashcardRepository(session)
        card = await repo.get(flashcard_id)
        if card is None or card.folder_id != folder_id:
            raise ResourceNotFoundException("Flashcard")
        await repo.delete(card)
        await session.commit()

    async def generate_from_file(
        self,
        folder_id: int,
        user_id: int,
        files: list[UploadFile],
        count: int,
        session: AsyncSession,
        provider: Optional[str] = None,
    ) -> list[FlashcardResponse]:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        content, _ = await self.file_service.extract_from_files(files)
        folder_files_content = await self.file_service.get_folder_files_content(folder_id, session)
        existing_flashcards = await self._existing_flashcard_context(folder_id, user_id, session)
        generated = await self.llm_service.generate_flashcards(
            content=self._join_contexts(content, folder_files_content),
            count=count,
            existing_flashcards=existing_flashcards,
            provider=provider,
        )
        repo = FlashcardRepository(session)
        cards = [
            await repo.create(folder_id, item.front, item.back, "generated_from_file")
            for item in generated
        ]
        await session.commit()
        return [FlashcardResponse.model_validate(card) for card in cards]

    async def get_weak_flashcards(
        self, folder_id: int, user_id: int, threshold: float, session: AsyncSession
    ) -> list[FlashcardResponse]:
        if threshold < 0 or threshold > 1:
            raise ValidationException("threshold must be between 0 and 1")
        cards = await self.list_flashcards(folder_id, user_id, session)
        return [
            card
            for card in sorted(cards, key=lambda item: item.difficulty, reverse=True)
            if card.success_rate is not None and card.success_rate < threshold
        ]

    async def _existing_flashcard_context(
        self, folder_id: int, user_id: int, session: AsyncSession
    ) -> list[str]:
        rows = await FlashcardRepository(session).list_with_stats(folder_id, user_id)
        return [
            f"Front: {card.front}\nBack: {card.back}"
            for card, _, _, _, _ in rows[:60]
        ]

    def _join_contexts(self, *parts: str) -> str:
        return "\n\n---\n\n".join(part.strip() for part in parts if part and part.strip())

    def _response_from_stats(
        self,
        card,
        attempt_count: int,
        correct_count: int,
        success_rate: Optional[float],
        last_attempted: object,
    ) -> FlashcardResponse:
        return FlashcardResponse.model_validate(card).model_copy(
            update={
                "attempt_count": int(attempt_count or 0),
                "correct_count": int(correct_count or 0),
                "success_rate": round(float(success_rate), 2) if success_rate is not None else None,
                "last_attempted": last_attempted if isinstance(last_attempted, datetime) else None,
            }
        )
