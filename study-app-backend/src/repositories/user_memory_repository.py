from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user_memory import UserMemory


class UserMemoryRepository:
    """Access layer for the one-per-user weekly memory row."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: int) -> Optional[UserMemory]:
        return await self.session.scalar(
            select(UserMemory).where(UserMemory.user_id == user_id)
        )

    async def upsert(self, user_id: int, content: str, generated_at: datetime) -> UserMemory:
        memory = await self.get(user_id)
        if memory is None:
            memory = UserMemory(user_id=user_id, content=content, generated_at=generated_at)
            self.session.add(memory)
        else:
            memory.content = content
            memory.generated_at = generated_at
        await self.session.flush()
        return memory
