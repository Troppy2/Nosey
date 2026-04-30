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
from src.services.file_service import FileService
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
        provider: str | None = None,
    ) -> KojoChatResponse:
        repo = KojoRepository(session)

        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        conversation = await repo.get_or_create_conversation(user_id, folder_id)

        notes = await repo.get_folder_notes_content(folder_id)
        folder_files = await FileService().get_folder_files_content(folder_id, session)
        context_parts = [part for part in (notes, folder_files) if part]
        notes_context = "\n\n---\n\n".join(context_parts) if context_parts else _NO_NOTES

        await repo.add_message(conversation.id, "user", user_message)

        history = await repo.get_history(
            conversation.id,
            limit=10,
            after=conversation.cleared_at,
        )

        prompt = _build_prompt(notes_context, user_message, history)

        try:
            if provider:
                kojo_response = await LLMService().call_kojo(prompt if isinstance(prompt, str) else str(prompt), provider=provider)
            else:
                kojo_response = await LLMService().call_kojo(prompt if isinstance(prompt, str) else str(prompt))
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
    # Build conversation history (all messages except the last, which is the current question)
    history_lines: list[str] = []
    for msg in history[:-1]:
        role_label = "Student" if msg.role == "user" else "Kojo"
        history_lines.append(f"{role_label}: {msg.content}")
    history_block = "\n\nCONVERSATION SO FAR:\n" + "\n".join(history_lines) if history_lines else ""

    has_notes = notes != _NO_NOTES
    notes_block = f"STUDENT'S STUDY NOTES AND FOLDER FILES:\n{notes[:12000]}" if has_notes else (
        "NOTE: The student has not uploaded any study materials yet. "
        "You can still answer general questions, but encourage them to upload notes for personalized help."
    )

    return f"""You are Kojo, an intelligent and supportive AI study companion built into Nosey, a study tool.
Your role is to help students genuinely understand their course material — not to give them answers to memorize.

{notes_block}
{history_block}

STUDENT'S MESSAGE: {user_message}

RESPONSE GUIDELINES:
- Draw from the student's notes and uploaded folder files whenever possible. Quote or reference specific sections to anchor your explanations.
- Use concrete examples, analogies, and step-by-step breakdowns to explain difficult concepts.
- Ask a follow-up question if the student seems confused or hasn't given you enough context.
- If the student asks you to "just give the answer" to a test question, gently redirect: explain the underlying concept instead.
- If the topic is not in the notes and is highly specific, say so clearly and suggest they check with their instructor or textbook.
- For math topics: write expressions clearly using LaTeX notation like \\frac{{dy}}{{dx}} = 3t^{{2}} + 1.
- For coding topics: provide short code snippets in fenced code blocks with the language tag.
- Keep responses focused and well-structured. Use bullet points or numbered steps when listing multiple ideas.
- Be warm, encouraging, and treat the student as capable — never condescending.

Respond now:"""
