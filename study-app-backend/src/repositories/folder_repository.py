from __future__ import annotations

from sqlalchemy import Select, func, select

from src.models.flashcard import Flashcard
from src.models.folder import Folder
from src.models.test import Test
from src.repositories.base_repository import BaseRepository
from typing import Optional


class FolderRepository(BaseRepository[Folder]):
    async def create(
        self, user_id: int, name: str, subject: Optional[str], description: Optional[str]
    ) -> Folder:
        folder = Folder(user_id=user_id, name=name, subject=subject, description=description)
        self.session.add(folder)
        await self.session.flush()
        return folder

    async def get_owned(self, folder_id: int, user_id: int) -> Optional[Folder]:
        return await self.session.scalar(
            select(Folder).where(Folder.id == folder_id, Folder.user_id == user_id)
        )

    async def list_with_counts(self, user_id: int) -> list[tuple[Folder, int, int]]:
        stmt: Select[tuple[Folder, int, int]] = (
            select(
                Folder,
                func.count(func.distinct(Test.id)).label("test_count"),
                func.count(func.distinct(Flashcard.id)).label("flashcard_count"),
            )
            .outerjoin(Test, Test.folder_id == Folder.id)
            .outerjoin(Flashcard, Flashcard.folder_id == Folder.id)
            .where(Folder.user_id == user_id)
            .group_by(Folder.id)
            .order_by(Folder.created_at.desc())
        )
        rows = await self.session.execute(stmt)
        return list(rows.all())
