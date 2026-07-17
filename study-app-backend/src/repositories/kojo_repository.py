from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.orm import selectinload

from src.models.conversation_file import ConversationFile
from src.models.folder import Folder
from src.models.kojo_action_card import KojoActionCard
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
        """Get the latest non-cleared conversation for a folder, or create one."""
        stmt = (
            select(KojoConversation)
            .where(
                and_(
                    KojoConversation.user_id == user_id,
                    KojoConversation.folder_id == folder_id,
                    KojoConversation.cleared_at.is_(None),
                )
            )
            .order_by(KojoConversation.created_at.desc())
            .limit(1)
        )
        conversation = await self.session.scalar(stmt)
        if not conversation:
            conversation = KojoConversation(user_id=user_id, folder_id=folder_id)
            self.session.add(conversation)
            await self.session.flush()
        return conversation

    async def create_general_conversation(self, user_id: int) -> KojoConversation:
        conversation = KojoConversation(user_id=user_id, folder_id=None)
        self.session.add(conversation)
        await self.session.flush()
        return conversation

    async def list_general_conversations(self, user_id: int) -> list[KojoConversation]:
        stmt = (
            select(KojoConversation)
            .where(
                and_(
                    KojoConversation.user_id == user_id,
                    KojoConversation.folder_id.is_(None),
                )
            )
            .order_by(KojoConversation.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create_conversation(self, user_id: int, folder_id: int) -> KojoConversation:
        conversation = KojoConversation(user_id=user_id, folder_id=folder_id)
        self.session.add(conversation)
        await self.session.flush()
        return conversation

    async def list_conversations_by_folder(
        self, user_id: int, folder_id: int
    ) -> list[KojoConversation]:
        stmt = (
            select(KojoConversation)
            .where(
                and_(
                    KojoConversation.user_id == user_id,
                    KojoConversation.folder_id == folder_id,
                )
            )
            .order_by(KojoConversation.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_conversation_by_id(
        self, conversation_id: int, user_id: int
    ) -> Optional[KojoConversation]:
        stmt = (
            select(KojoConversation)
            .where(
                and_(
                    KojoConversation.id == conversation_id,
                    KojoConversation.user_id == user_id,
                )
            )
            .options(selectinload(KojoConversation.messages))
        )
        return await self.session.scalar(stmt)

    async def set_conversation_name(self, conversation_id: int, name: str) -> None:
        stmt = select(KojoConversation).where(KojoConversation.id == conversation_id)
        conversation = await self.session.scalar(stmt)
        if conversation and not conversation.name:
            conversation.name = name
            await self.session.flush()

    async def rename_conversation(
        self, conversation_id: int, user_id: int, name: str
    ) -> Optional[KojoConversation]:
        """User-driven rename. Unlike set_conversation_name (the auto-namer, which
        only fills a blank), this overwrites whatever name is already there."""
        conversation = await self.get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            return None
        conversation.name = name
        await self.session.flush()
        return conversation

    async def get_owned(self, conversation_id: int, user_id: int) -> Optional[KojoConversation]:
        stmt = (
            select(KojoConversation)
            .where(
                and_(KojoConversation.id == conversation_id, KojoConversation.user_id == user_id)
            )
            .options(selectinload(KojoConversation.messages))
        )
        return await self.session.scalar(stmt)

    async def get_by_folder(self, user_id: int, folder_id: int) -> Optional[KojoConversation]:
        stmt = (
            select(KojoConversation)
            .where(
                and_(KojoConversation.user_id == user_id, KojoConversation.folder_id == folder_id)
            )
            .options(selectinload(KojoConversation.messages))
            .order_by(KojoConversation.created_at.desc())
            .limit(1)
        )
        return await self.session.scalar(stmt)

    async def add_message(self, conversation_id: int, role: str, content: str) -> KojoMessage:
        message = KojoMessage(conversation_id=conversation_id, role=role, content=content)
        self.session.add(message)
        await self.session.flush()
        return message

    async def delete_message_by_id(self, message_id: int) -> None:
        """Hard-delete a single message (used when regenerating an answer)."""
        message = await self.session.get(KojoMessage, message_id)
        if message is not None:
            await self.session.delete(message)
            await self.session.flush()

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

    async def get_folder_notes_content(self, folder_id: int, user_id: int) -> str:
        """Practice-test snapshots for the folder's tests (Kojo context).

        Returns only practice-test PDF snapshots (file_type "pdf"). Those are
        uploaded straight into test creation and never exist as live folder
        files, so they cannot be deleted out from under Kojo and carry no
        stale-content risk.

        The "combined" snapshots (frozen copies of folder files taken at test
        creation) are intentionally excluded: Kojo reads live folder files via
        FileService.get_folder_files_content instead. This keeps deleted or
        edited folder files from leaking back into Kojo through old test
        snapshots, and avoids feeding Kojo duplicate copies of the same notes.
        """
        stmt = (
            select(Note)
            .join(Test, Test.id == Note.test_id)
            .join(Folder, Folder.id == Test.folder_id)
            .where(
                Test.folder_id == folder_id,
                Folder.user_id == user_id,
                Note.file_type == "pdf",
            )
        )
        result = await self.session.execute(stmt)
        notes = result.scalars().all()
        if not notes:
            return ""
        return "\n\n---\n\n".join(
            f"[{note.file_name}]\n{note.content}" for note in notes
        )

    async def clear_conversation(self, user_id: int, folder_id: int) -> Optional[KojoConversation]:
        stmt = (
            select(KojoConversation)
            .where(
                and_(KojoConversation.user_id == user_id, KojoConversation.folder_id == folder_id)
            )
            .order_by(KojoConversation.created_at.desc())
            .limit(1)
        )
        conversation = await self.session.scalar(stmt)
        if conversation is None:
            return None
        conversation.cleared_at = datetime.utcnow()
        await self.session.flush()
        return conversation

    async def clear_conversation_by_id(
        self, conversation_id: int, user_id: int
    ) -> Optional[KojoConversation]:
        stmt = select(KojoConversation).where(
            and_(KojoConversation.id == conversation_id, KojoConversation.user_id == user_id)
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

    async def add_conversation_file(
        self,
        conversation_id: int,
        file_name: str,
        file_type: str,
        size_bytes: int,
        content: str,
    ) -> ConversationFile:
        f = ConversationFile(
            conversation_id=conversation_id,
            file_name=file_name,
            file_type=file_type,
            size_bytes=size_bytes,
            content=content,
        )
        self.session.add(f)
        await self.session.flush()
        return f

    async def get_conversation_files(self, conversation_id: int) -> list[ConversationFile]:
        stmt = (
            select(ConversationFile)
            .where(ConversationFile.conversation_id == conversation_id)
            .order_by(ConversationFile.uploaded_at)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_conversation_file_owned(
        self, file_id: int, conversation_id: int
    ) -> Optional[ConversationFile]:
        stmt = select(ConversationFile).where(
            and_(ConversationFile.id == file_id, ConversationFile.conversation_id == conversation_id)
        )
        return await self.session.scalar(stmt)

    async def delete_conversation(self, conversation_id: int, user_id: int) -> bool:
        """Hard-delete a conversation and all its messages/files (cascade via ORM)."""
        stmt = (
            select(KojoConversation)
            .where(
                and_(KojoConversation.id == conversation_id, KojoConversation.user_id == user_id)
            )
            .options(
                selectinload(KojoConversation.messages),
                selectinload(KojoConversation.conversation_files),
            )
        )
        conversation = await self.session.scalar(stmt)
        if conversation is None:
            return False
        await self.session.delete(conversation)
        await self.session.flush()
        return True

    async def delete_conversation_files(self, conversation_id: int) -> None:
        """Delete all session files for a conversation (called on clear/new chat)."""
        stmt = select(ConversationFile).where(ConversationFile.conversation_id == conversation_id)
        result = await self.session.execute(stmt)
        for f in result.scalars().all():
            await self.session.delete(f)
        await self.session.flush()

    async def add_action_card(
        self,
        conversation_id: int,
        action_type: str,
        payload_json: str,
        message_id: Optional[int] = None,
    ) -> KojoActionCard:
        card = KojoActionCard(
            conversation_id=conversation_id,
            message_id=message_id,
            action_type=action_type,
            status="proposed",
            payload_json=payload_json,
        )
        self.session.add(card)
        await self.session.flush()
        return card

    async def get_action_cards(self, conversation_id: int) -> list[KojoActionCard]:
        stmt = (
            select(KojoActionCard)
            .where(KojoActionCard.conversation_id == conversation_id)
            .order_by(KojoActionCard.created_at)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_action_card_owned(
        self, card_id: int, user_id: int
    ) -> Optional[KojoActionCard]:
        stmt = (
            select(KojoActionCard)
            .join(KojoConversation, KojoConversation.id == KojoActionCard.conversation_id)
            .where(
                and_(KojoActionCard.id == card_id, KojoConversation.user_id == user_id)
            )
        )
        return await self.session.scalar(stmt)

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
