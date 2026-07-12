from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.folder_repository import FolderRepository
from src.schemas.folder_schema import FolderCreate, FolderResponse, FolderUpdate
from src.services.kojo_context_cache import invalidate_folder
from src.utils.exceptions import ResourceNotFoundException


class FolderService:
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
        folder = await FolderRepository(session).create(
            user_id=user_id,
            name=data.name,
            subject=data.subject,
            description=data.description,
        )
        await session.commit()
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
        await session.commit()
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
