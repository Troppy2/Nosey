from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.folder_repository import FolderRepository
from src.schemas.folder_schema import FolderCreate, FolderResponse, FolderUpdate
from src.utils.exceptions import ResourceNotFoundException


class FolderService:
    async def list_folders(self, user_id: int, session: AsyncSession) -> list[FolderResponse]:
        rows = await FolderRepository(session).list_with_counts(user_id)
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
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        rows = await FolderRepository(session).list_with_counts(user_id)
        for row_folder, test_count, flashcard_count in rows:
            if row_folder.id == folder_id:
                return FolderResponse.model_validate(row_folder).model_copy(
                    update={"test_count": test_count, "flashcard_count": flashcard_count}
                )
        return FolderResponse.model_validate(folder)

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
        await session.commit()
        await session.refresh(folder)
        return FolderResponse.model_validate(folder)

    async def delete_folder(self, folder_id: int, user_id: int, session: AsyncSession) -> None:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        await session.delete(folder)
        await session.commit()
