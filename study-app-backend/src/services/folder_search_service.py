from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.folder_search_repository import FolderSearchRepository
from src.schemas.folder_search_schema import FolderSearchResponse, FolderSearchResult


class FolderSearchService:
    async def search(
        self, user_id: int, query: str, session: AsyncSession, limit: int = 20,
    ) -> FolderSearchResponse:
        query = query.strip().lower()
        if not query:
            return FolderSearchResponse(results=[])
        rows = await FolderSearchRepository(session).search(user_id, query, limit)
        return FolderSearchResponse(
            results=[FolderSearchResult(**row) for row in rows[:limit]],
            has_more=len(rows) > limit,
        )
