from typing import Literal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.models.user import User
from src.repositories.folder_repository import FolderRepository
from src.schemas.folder_schema import FolderCreate, FolderResponse, FolderUpdate
from src.services.kojo_context_cache import invalidate_folder
from src.utils.exceptions import ResourceNotFoundException, ValidationException


def _duplicate_name_error(name: str) -> ValidationException:
    # uq_folders_user_name also covers archived folders, which the main list hides.
    return ValidationException(
        f'You already have a folder named "{name}". '
        "Check your archived folders or pick a different name."
    )


async def _lock_user(user_id: int, session: AsyncSession) -> None:
    # Serialize order/bulk writes from multiple tabs for the same account.
    await session.execute(select(User.id).where(User.id == user_id).with_for_update())


class FolderService:
    async def reorder_folders(
        self, user_id: int, folder_ids: list[int], session: AsyncSession
    ) -> list[FolderResponse]:
        await _lock_user(user_id, session)
        folders = await FolderRepository(session).list_active(user_id)
        # A set mismatch also catches duplicates: [a, a, c] never equals {a, b, c}.
        if len(folder_ids) != len(folders) or set(folder_ids) != {folder.id for folder in folders}:
            raise ValidationException("Your folders changed. Refresh the list before saving its order.")
        positions = {folder_id: index for index, folder_id in enumerate(folder_ids)}
        for folder in folders:
            folder.display_order = positions[folder.id]
        await session.commit()
        return await self.list_folders(user_id, session)

    async def bulk_action(
        self, user_id: int, folder_ids: list[int], action: Literal["archive", "delete"], session: AsyncSession
    ) -> int:
        # Ids are non-empty and unique per FolderSelection; action is checked by FolderBulkAction.
        await _lock_user(user_id, session)
        folders = await FolderRepository(session).get_many_owned(folder_ids, user_id)
        if len(folders) != len(folder_ids):
            raise ResourceNotFoundException("Folder")
        try:
            for folder in folders:
                if action == "archive":
                    folder.is_archived = True
                else:
                    # Preserve the existing single-folder ORM cascade behavior.
                    await session.delete(folder)
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        if action == "delete":
            for folder_id in folder_ids:
                invalidate_folder(folder_id)
        return len(folders)

    async def list_folders(self, user_id: int, session: AsyncSession) -> list[FolderResponse]:
        rows = await FolderRepository(session).list_with_counts(user_id, archived=False)
        return [
            FolderResponse.model_validate(folder).model_copy(
                update={"test_count": test_count, "flashcard_count": flashcard_count}
            )
            for folder, test_count, flashcard_count in rows
        ]

    async def list_archived_folders(self, user_id: int, session: AsyncSession) -> list[FolderResponse]:
        rows = await FolderRepository(session).list_with_counts(user_id, archived=True)
        return [
            FolderResponse.model_validate(folder).model_copy(
                update={"test_count": test_count, "flashcard_count": flashcard_count}
            )
            for folder, test_count, flashcard_count in rows
        ]

    async def create_folder(
        self, user_id: int, data: FolderCreate, session: AsyncSession
    ) -> FolderResponse:
        try:
            folder = await FolderRepository(session).create(
                user_id=user_id,
                name=data.name,
                subject=data.subject,
                description=data.description,
            )
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise _duplicate_name_error(data.name) from exc
        return FolderResponse.model_validate(folder)

    async def get_folder(self, folder_id: int, user_id: int, session: AsyncSession) -> FolderResponse:
        row = await FolderRepository(session).get_with_counts(folder_id, user_id)
        if row is None:
            raise ResourceNotFoundException("Folder")
        folder, test_count, flashcard_count = row
        return FolderResponse.model_validate(folder).model_copy(
            update={"test_count": test_count, "flashcard_count": flashcard_count}
        )

    async def update_folder(
        self, folder_id: int, user_id: int, data: FolderUpdate, session: AsyncSession
    ) -> FolderResponse:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        if data.name is not None:
            folder.name = data.name
        if data.subject is not None:
            folder.subject = data.subject
        if data.description is not None:
            folder.description = data.description
        if data.kojo_sync_default is not None:
            folder.kojo_sync_default = data.kojo_sync_default
        if data.kojo_allow_artifacts is not None:
            folder.kojo_allow_artifacts = data.kojo_allow_artifacts
        if data.kojo_auto_index is not None:
            folder.kojo_auto_index = data.kojo_auto_index
        if data.kojo_persona is not None:
            folder.kojo_persona = data.kojo_persona
        if data.is_archived is not None:
            folder.is_archived = data.is_archived
        if data.avoid_repeat_questions is not None:
            folder.avoid_repeat_questions = data.avoid_repeat_questions
        if data.default_view is not None:
            folder.default_view = data.default_view
        if data.test_instructions is not None:
            folder.test_instructions = data.test_instructions.strip() or None
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise _duplicate_name_error(data.name or "") from exc
        await session.refresh(folder)
        return FolderResponse.model_validate(folder)

    async def delete_folder(self, folder_id: int, user_id: int, session: AsyncSession) -> None:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        await session.delete(folder)
        await session.commit()
        # Free the cached Kojo context; folder ids are not reused, this is
        # purely to release the memory early instead of waiting for the TTL.
        invalidate_folder(folder_id)
