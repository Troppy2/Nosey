from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.folder_repository import FolderRepository
from src.repositories.kojo_repository import KojoRepository
from src.schemas.kojo_schema import (
    KojoChatResponse,
    KojoClearResponse,
    KojoClearedConversationDTO,
    KojoConversationDTO,
    KojoMessageDTO,
    KojoRestoreResponse,
)
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ResourceNotFoundException
from src.utils.logger import get_logger

logger = get_logger(__name__)

_NO_NOTES = "[No study materials uploaded yet. Ask the student to upload notes first.]"
_CLEAR_WINDOW_HOURS = 5


class KojoService:
    async def chat(
        self,
        user_id: int,
        folder_id: int,
        user_message: str,
        session: AsyncSession,
    ) -> KojoChatResponse:
        repo = KojoRepository(session)

        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        conversation = await repo.get_or_create_conversation(user_id, folder_id)

        notes = await repo.get_folder_notes_content(folder_id)
        notes_context = notes or _NO_NOTES

        await repo.add_message(conversation.id, "user", user_message)

        history = await repo.get_history(
            conversation.id,
            limit=10,
            after=conversation.cleared_at,
        )

        prompt = _build_prompt(notes_context, user_message, history)

        try:
            kojo_response = await LLMService().call_kojo(prompt)
        except LLMException:
            raise
        except Exception as exc:
            logger.warning("Kojo LLM call failed: %s", exc)
            raise LLMException("Kojo failed to generate a response. Try again.") from exc

        flagged = (
            "can't help" in kojo_response.lower()
            or "cannot help" in kojo_response.lower()
            or "not covered in your" in kojo_response.lower()
        )

        kojo_msg = await repo.add_message(conversation.id, "assistant", kojo_response)
        await session.commit()

        logger.info(
            "Kojo chat completed",
            extra={"user_id": user_id, "conversation_id": conversation.id},
        )

        return KojoChatResponse(
            response=kojo_response,
            conversation_id=conversation.id,
            message_id=kojo_msg.id,
            flagged_uncertain=flagged,
        )

    async def get_conversation(
        self,
        user_id: int,
        folder_id: int,
        session: AsyncSession,
    ) -> KojoConversationDTO:
        repo = KojoRepository(session)
        conversation = await repo.get_by_folder(user_id, folder_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")
        visible_messages = conversation.messages
        if conversation.cleared_at is not None:
            visible_messages = [
                msg for msg in conversation.messages if msg.created_at > conversation.cleared_at
            ]
        return KojoConversationDTO(
            id=conversation.id,
            folder_id=conversation.folder_id,
            messages=[
                KojoMessageDTO(
                    id=msg.id,
                    role=msg.role,
                    content=msg.content,
                    created_at=msg.created_at,
                )
                for msg in visible_messages
            ],
            created_at=conversation.created_at,
            cleared_at=conversation.cleared_at,
        )

    async def clear_conversation(
        self,
        user_id: int,
        folder_id: int,
        session: AsyncSession,
    ) -> KojoClearResponse:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        repo = KojoRepository(session)
        conversation = await repo.clear_conversation(user_id, folder_id)
        if conversation is None:
            conversation = await repo.get_or_create_conversation(user_id, folder_id)
            conversation.cleared_at = datetime.utcnow()
            await session.flush()

        await session.commit()

        cleared_at = conversation.cleared_at or datetime.utcnow()
        return KojoClearResponse(
            conversation_id=conversation.id,
            folder_id=folder_id,
            cleared_at=cleared_at,
            restore_expires_at=cleared_at + timedelta(hours=_CLEAR_WINDOW_HOURS),
        )

    async def restore_conversation(
        self,
        user_id: int,
        folder_id: int,
        session: AsyncSession,
    ) -> KojoRestoreResponse:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        restored = await KojoRepository(session).restore_conversation(user_id, folder_id)
        if restored:
            await session.commit()

        return KojoRestoreResponse(folder_id=folder_id, restored=restored)

    async def get_cleared_conversations(
        self,
        user_id: int,
        session: AsyncSession,
    ) -> list[KojoClearedConversationDTO]:
        conversations = await KojoRepository(session).get_cleared_conversations(user_id)
        result: list[KojoClearedConversationDTO] = []
        for conv in conversations:
            if conv.cleared_at is None:
                continue
            result.append(
                KojoClearedConversationDTO(
                    conversation_id=conv.id,
                    folder_id=conv.folder_id,
                    folder_name=conv.folder.name if conv.folder is not None else f"Folder {conv.folder_id}",
                    cleared_at=conv.cleared_at,
                    restore_expires_at=conv.cleared_at + timedelta(hours=_CLEAR_WINDOW_HOURS),
                )
            )
        return result


def _build_prompt(notes: str, user_message: str, history: list) -> str:
    history_text = ""
    if len(history) > 1:
        history_text = "\n\nPREVIOUS CONVERSATION:\n"
        for msg in history[:-1]:
            history_text += f"{msg.role.upper()}: {msg.content}\n"

    return f"""You are Kojo, a study companion. Help students understand material from their notes.

STUDENT'S NOTES:
{notes[:10000]}
{history_text}
CURRENT QUESTION: {user_message}

RULES:
1. Explain concepts using the notes. Give examples. Encourage thinking.
2. REFUSE direct test answers, grading, or solving problems for the student.
3. If you can't help directly, say: "I can't help with that directly. But I can help you understand [concept]. What part is confusing?"
4. If the topic isn't in the notes, say: "That topic isn't in your uploaded notes. I'd suggest asking your instructor."
5. Be encouraging and concise.

Respond to the student's question now:"""
