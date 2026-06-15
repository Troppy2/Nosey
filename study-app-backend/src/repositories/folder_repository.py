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

    @staticmethod
    def _test_count_subquery():
        # Correlated scalar count on the indexed test.folder_id. Using subqueries
        # instead of joining both test and flashcard avoids a cartesian fan-out
        # (tests x flashcards rows per folder) that COUNT(DISTINCT) would hide.
        return (
            select(func.count(Test.id))
            .where(Test.folder_id == Folder.id)
            .correlate(Folder)
            .scalar_subquery()
        )

    @staticmethod
    def _flashcard_count_subquery():
        return (
            select(func.count(Flashcard.id))
            .where(Flashcard.folder_id == Folder.id)
            .correlate(Folder)
            .scalar_subquery()
        )

    async def list_with_counts(self, user_id: int, archived: bool = False) -> list[tuple[Folder, int, int]]:
        stmt: Select[tuple[Folder, int, int]] = (
            select(
                Folder,
                self._test_count_subquery().label("test_count"),
                self._flashcard_count_subquery().label("flashcard_count"),
            )
            .where(Folder.user_id == user_id, Folder.is_archived == archived)
            .order_by(Folder.created_at.desc())
        )
        rows = await self.session.execute(stmt)
        return list(rows.all())

    async def get_with_counts(self, folder_id: int, user_id: int) -> Optional[tuple[Folder, int, int]]:
        stmt: Select[tuple[Folder, int, int]] = (
            select(
                Folder,
                self._test_count_subquery().label("test_count"),
                self._flashcard_count_subquery().label("flashcard_count"),
            )
            .where(Folder.id == folder_id, Folder.user_id == user_id)
        )
        row = (await self.session.execute(stmt)).first()
        return tuple(row) if row is not None else None
