from sqlalchemy import case, func, literal, select, union_all

from src.models.folder import Folder
from src.models.test import Test
from src.repositories.base_repository import BaseRepository


class FolderSearchRepository(BaseRepository[Folder]):
    async def search(self, user_id: int, query: str, limit: int) -> list[dict]:
        rows = await self.session.execute(self.statement(user_id, query, limit))
        return [dict(row) for row in rows.mappings()]

    @staticmethod
    def statement(user_id: int, query: str, limit: int):
        # Escape LIKE metacharacters: '%' and '_' in a title are literal input.
        escaped = query.replace("/", "//").replace("%", "/%").replace("_", "/_")
        prefix = escaped + "%"
        # Trigrams cannot accelerate a one/two-character substring. Use the
        # matching prefix indexes for these short queries instead.
        pattern = f"%{escaped}%" if len(query) >= 3 else prefix

        def columns(kind, identifier, title, folder_id, folder_name, subject):
            normalized = func.lower(title)
            rank = case((normalized == query, 0), (normalized.like(prefix, escape="/"), 1), else_=2)
            return (
                literal(kind).label("kind"), identifier.label("id"), title.label("title"),
                folder_id.label("folder_id"), folder_name.label("folder_name"), subject.label("subject"),
                rank.label("rank"), normalized.label("sort_title"),
            )

        owned_active = (Folder.user_id == user_id, Folder.is_archived.is_(False))
        folders = (
            select(*columns("folder", Folder.id, Folder.name, Folder.id, literal(None), Folder.subject))
            .where(*owned_active, func.lower(Folder.name).like(pattern, escape="/"))
            .order_by("rank", "sort_title", Folder.id)
            .limit(limit + 1).subquery()
        )
        tests = (
            select(*columns("test", Test.id, Test.title, Folder.id, Folder.name, literal(None)))
            .join(Folder, Test.folder_id == Folder.id)
            .where(*owned_active, func.lower(Test.title).like(pattern, escape="/"))
            .order_by("rank", "sort_title", Test.id)
            .limit(limit + 1).subquery()
        )
        candidates = union_all(select(folders), select(tests)).subquery()
        return select(candidates).order_by(
            candidates.c.rank, candidates.c.sort_title, candidates.c.kind, candidates.c.id,
        ).limit(limit + 1)
