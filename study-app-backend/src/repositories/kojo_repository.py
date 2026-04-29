from __future__ import annotations

from sqlalchemy import and_, select
from sqlalchemy.orm import selectinload

from src.models.kojo_conversation import KojoConversation
from src.models.kojo_message import KojoMessage
from src.models.note import Note
from src.models.test import Test
from src.repositories.base_repository import BaseRepository


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

    async def get_history(self, conversation_id: int, limit: int = 10) -> list[KojoMessage]:
        stmt = (
            select(KojoMessage)
            .where(KojoMessage.conversation_id == conversation_id)
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
