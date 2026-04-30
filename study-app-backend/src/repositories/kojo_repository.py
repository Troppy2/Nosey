from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.orm import selectinload

from src.models.folder import Folder
from src.models.kojo_conversation import KojoConversation
from src.models.kojo_message import KojoMessage
from src.models.note import Note
from src.models.test import Test
from src.repositories.base_repository import BaseRepository

_CLEAR_WINDOW_HOURS = 5


class KojoRepository(BaseRepository[KojoConversation]):
    async def get_or_create_conversation(
        self, user_id: int, folder_id: int
    ) -> KojoConversation:
        stmt = select(KojoConversation).where(
            and_(KojoConversation.user_id == user_id, KojoConversation.folder_id == folder_id)
        )
        conversation = await self.session.scalar(stmt)
        if not conversation:
            conversation = KojoConversation(user_id=user_id, folder_id=folder_id)
            self.session.add(conversation)
            await self.session.flush()
        return conversation

    async def get_owned(self, conversation_id: int, user_id: int) -> KojoConversation | None:
        stmt = (
            select(KojoConversation)
            .where(
                and_(KojoConversation.id == conversation_id, KojoConversation.user_id == user_id)
            )
            .options(selectinload(KojoConversation.messages))
        )
        return await self.session.scalar(stmt)

    async def get_by_folder(self, user_id: int, folder_id: int) -> KojoConversation | None:
        stmt = (
            select(KojoConversation)
            .where(
                and_(KojoConversation.user_id == user_id, KojoConversation.folder_id == folder_id)
            )
            .options(selectinload(KojoConversation.messages))
        )
        return await self.session.scalar(stmt)

    async def add_message(self, conversation_id: int, role: str, content: str) -> KojoMessage:
        message = KojoMessage(conversation_id=conversation_id, role=role, content=content)
        self.session.add(message)
        await self.session.flush()
        return message

    async def get_history(
        self, conversation_id: int, limit: int = 10, after: Optional[datetime] = None
    ) -> list[KojoMessage]:
        conditions = [KojoMessage.conversation_id == conversation_id]
        if after is not None:
            conditions.append(KojoMessage.created_at > after)
        stmt = (
            select(KojoMessage)
            .where(and_(*conditions))
            .order_by(KojoMessage.created_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        messages = list(result.scalars().all())
        return list(reversed(messages))

    async def get_folder_notes_content(self, folder_id: int) -> str:
        stmt = select(Note).join(Test, Test.id == Note.test_id).where(Test.folder_id == folder_id)
        result = await self.session.execute(stmt)
        notes = result.scalars().all()
        if not notes:
            return ""
        return "\n\n---\n\n".join(
            f"[{note.file_name}]\n{note.content}" for note in notes
        )

    async def clear_conversation(self, user_id: int, folder_id: int) -> KojoConversation | None:
        stmt = select(KojoConversation).where(
            and_(KojoConversation.user_id == user_id, KojoConversation.folder_id == folder_id)
        )
        conversation = await self.session.scalar(stmt)
        if conversation is None:
            return None
        conversation.cleared_at = datetime.utcnow()
        await self.session.flush()
        return conversation

    async def restore_conversation(self, user_id: int, folder_id: int) -> bool:
        stmt = select(KojoConversation).where(
            and_(KojoConversation.user_id == user_id, KojoConversation.folder_id == folder_id)
        )
        conversation = await self.session.scalar(stmt)
        if conversation is None or conversation.cleared_at is None:
            return False
        cutoff = datetime.utcnow() - timedelta(hours=_CLEAR_WINDOW_HOURS)
        if conversation.cleared_at < cutoff:
            return False
        conversation.cleared_at = None
        await self.session.flush()
        return True

    async def get_cleared_conversations(self, user_id: int) -> list[KojoConversation]:
        cutoff = datetime.utcnow() - timedelta(hours=_CLEAR_WINDOW_HOURS)
        stmt = (
            select(KojoConversation)
            .where(
                and_(
                    KojoConversation.user_id == user_id,
                    KojoConversation.cleared_at.isnot(None),
                    KojoConversation.cleared_at >= cutoff,
                )
            )
            .options(selectinload(KojoConversation.folder))
            .order_by(KojoConversation.cleared_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
