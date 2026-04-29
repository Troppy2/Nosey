from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.folder_repository import FolderRepository
from src.repositories.kojo_repository import KojoRepository
from src.schemas.kojo_schema import KojoChatResponse, KojoConversationDTO, KojoMessageDTO
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ResourceNotFoundException
from src.utils.logger import get_logger

logger = get_logger(__name__)

_NO_NOTES = "[No study materials uploaded yet. Ask the student to upload notes first.]"


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

        history = await repo.get_history(conversation.id, limit=10)

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
                for msg in conversation.messages
            ],
            created_at=conversation.created_at,
        )


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
