from __future__ import annotations

import re
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.attempt_repository import AttemptRepository
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
from typing import Optional

logger = get_logger(__name__)

_NO_NOTES = "[No study materials uploaded yet. Ask the student to upload notes first.]"
_CLEAR_WINDOW_HOURS = 5


def _is_review_wrong_answers_request(user_message: str) -> bool:
    """Check if user is asking to review wrong answers from their test."""
    message_lower = user_message.lower()
    review_keywords = [
        "review.*wrong",
        "wrong.*answer",
        "check.*wrong",
        "see.*wrong",
        "what.*wrong",
        "missed",
        "incorrect",
        "fail",
        "got wrong",
        "did i get wrong",
        "i got wrong",
    ]
    return any(re.search(kw, message_lower) for kw in review_keywords)


def _format_wrong_answers_context(wrong_answers_data: list[tuple]) -> str:
    """Format wrong answers into a readable context for the LLM."""
    lines = ["STUDENT'S RECENT WRONG ANSWERS:\n"]
    for i, (question, user_answer) in enumerate(wrong_answers_data, 1):
        lines.append(f"\n--- Question {i} ---")
        lines.append(f"Type: {question.question_type.upper()}")
        lines.append(f"Question: {question.question_text}")
        lines.append(f"Student's Answer: {user_answer.user_answer}")

        if question.question_type == "MCQ":
            correct_option = next(
                (opt for opt in question.mcq_options if opt.is_correct),
                None,
            )
            if correct_option:
                lines.append(f"Correct Answer: {correct_option.option_text}")
        elif question.question_type == "FRQ":
            if question.frq_answer:
                lines.append(f"Correct Answer: {question.frq_answer.expected_answer}")

    return "\n".join(lines)


class KojoService:
    async def chat(
        self,
        user_id: int,
        folder_id: int,
        user_message: str,
        session: AsyncSession,
        provider: Optional[str] = None,
        beta_enabled: bool = False,
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

        # Check if user is asking to review wrong answers
        if _is_review_wrong_answers_request(user_message):
            wrong_answers_result = await AttemptRepository(session).get_recent_wrong_answers(user_id)
            if wrong_answers_result:
                attempt, wrong_answers_data = wrong_answers_result
                await repo.add_message(conversation.id, "user", user_message)
                history = await repo.get_history(conversation.id, limit=10, after=conversation.cleared_at)
                wrong_answers_context = _format_wrong_answers_context(wrong_answers_data)
                prompt = _build_review_wrong_answers_prompt(notes_context, wrong_answers_context, user_message, history)
            else:
                # No recent wrong answers found
                await repo.add_message(conversation.id, "user", user_message)
                response = "You don't have any wrong answers from your most recent test to review. Keep practicing!"
                kojo_msg = await repo.add_message(conversation.id, "assistant", response)
                await session.commit()
                return KojoChatResponse(
                    response=response,
                    conversation_id=conversation.id,
                    message_id=kojo_msg.id,
                    flagged_uncertain=False,
                )
        else:
            # Regular Kojo chat
            await repo.add_message(conversation.id, "user", user_message)
            history = await repo.get_history(conversation.id, limit=10, after=conversation.cleared_at)
            prompt = _build_prompt(notes_context, user_message, history)

        active_provider = provider

        try:
            if active_provider:
                kojo_response = await LLMService().call_kojo(prompt if isinstance(prompt, str) else str(prompt), provider=active_provider)
            else:
                kojo_response = await LLMService().call_kojo(prompt if isinstance(prompt, str) else str(prompt))
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


_STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
    "how", "its", "may", "new", "now", "old", "see", "two", "way", "who",
    "did", "each", "from", "have", "what", "this", "that", "with", "want",
    "help", "explain", "show", "tell", "give", "does", "work", "will",
    "would", "could", "should", "about", "into", "there", "their", "then",
    "than", "when", "where", "which", "while", "also", "more", "like",
    "just", "here", "even", "know", "come", "said", "make", "look", "use",
    "some", "very", "over", "such", "been", "they", "them", "these",
}


def _extract_relevant_sections(notes: str, user_message: str, max_sections: int = 6) -> str:
    """Return the paragraphs from notes that best match the user's question keywords."""
    keywords = [
        w for w in re.findall(r"[a-zA-Z]{3,}", user_message.lower())
        if w not in _STOPWORDS
    ]
    if not keywords:
        return ""

    # Split on blank lines or section separators into meaningful chunks
    raw_chunks = re.split(r"\n{2,}|(?:^|\n)---+(?:\n|$)", notes)
    paragraphs = [c.strip() for c in raw_chunks if len(c.strip()) > 40]

    scored: list[tuple[int, str]] = []
    for para in paragraphs:
        para_lower = para.lower()
        score = sum(1 for kw in keywords if kw in para_lower)
        if score > 0:
            scored.append((score, para))

    scored.sort(key=lambda x: x[0], reverse=True)
    return "\n\n".join(para for _, para in scored[:max_sections])


def _build_review_wrong_answers_prompt(notes: str, wrong_answers: str, user_message: str, history: list) -> str:
    """Build prompt for reviewing wrong answers with RAG-enhanced feedback."""
    history_lines: list[str] = []
    for msg in history[:-1]:
        role_label = "Student" if msg.role == "user" else "Kojo"
        history_lines.append(f"{role_label}: {msg.content}")
    history_block = "\n\nCONVERSATION SO FAR:\n" + "\n".join(history_lines) if history_lines else ""

    has_notes = notes != _NO_NOTES

    if has_notes:
        relevant = _extract_relevant_sections(notes, wrong_answers)
        relevant_block = (
            "RELEVANT SECTIONS FROM STUDENT'S NOTES (pre-matched to their answers):\n"
            f"{relevant}\n\n"
            if relevant else
            "NOTE: No closely matching sections found in their notes for these answers.\n\n"
        )
        notes_block = (
            f"{relevant_block}"
            f"FULL STUDENT NOTES AND FOLDER FILES:\n{notes[:12000]}"
        )
    else:
        relevant_block = ""
        notes_block = (
            "NOTE: The student has not uploaded any study materials yet. "
            "Provide the correct answers and explanations, and suggest they cross-reference with online resources or their textbook."
        )

    return f"""You are Kojo, an intelligent and supportive AI study companion built into Nosey, a study tool.
Your role is to help students learn from their mistakes in a constructive and encouraging way.

{wrong_answers}

{notes_block}
{history_block}

STUDENT'S REQUEST: {user_message}

REVIEW GUIDELINES - FOLLOW THESE STRICTLY:
1. For each wrong answer, provide:
   - The correct answer (clearly stated)
   - Why it is correct (concise explanation, 2-3 sentences max)
   - Where in their notes this information appears (if found)

2. Reference handling:
   - ALWAYS check if the answer is covered in the RELEVANT SECTIONS above
   - If found: Say "From your notes: [quote relevant section]" and explain why it matters
   - If NOT found: Say explicitly "This question is not covered in your notes, but here's what you need to know: [answer + explanation]"
   - Then suggest they cross-reference with online resources or their class materials

3. Keep responses:
   - Focused and structured (use bullet points for clarity)
   - Concise (not essays — 2-4 sentences per question max)
   - Encouraging and supportive in tone
   - Direct: no fluff or unnecessary preamble

4. Formatting:
   - For math: wrap expressions in KaTeX ($...$ for inline, $$...$$ for display)
   - For code: use fenced blocks with language tags
   - For each question, use clear headers like "Question 1:" or "MCQ Question:"

Respond now:"""


def _build_prompt(notes: str, user_message: str, history: list) -> str:
    history_lines: list[str] = []
    for msg in history[:-1]:
        role_label = "Student" if msg.role == "user" else "Kojo"
        history_lines.append(f"{role_label}: {msg.content}")
    history_block = "\n\nCONVERSATION SO FAR:\n" + "\n".join(history_lines) if history_lines else ""

    has_notes = notes != _NO_NOTES

    if has_notes:
        relevant = _extract_relevant_sections(notes, user_message)
        relevant_block = (
            "RELEVANT SECTIONS FROM STUDENT'S NOTES (pre-matched to their question):\n"
            f"{relevant}\n\n"
            if relevant else
            "RELEVANT SECTIONS: [No closely matching sections found — use the full notes below.]\n\n"
        )
        notes_block = (
            f"{relevant_block}"
            f"FULL STUDENT NOTES AND FOLDER FILES:\n{notes[:12000]}"
        )
    else:
        relevant_block = ""
        notes_block = (
            "NOTE: The student has not uploaded any study materials yet. "
            "You can still answer general questions, but encourage them to upload notes for personalized help."
        )

    return f"""You are Kojo, an intelligent and supportive AI study companion built into Nosey, a study tool.
Your role is to help students genuinely understand their course material — not to give them answers to memorize.

{notes_block}
{history_block}

STUDENT'S MESSAGE: {user_message}

RESPONSE GUIDELINES:
- ALWAYS check the RELEVANT SECTIONS above first before answering — they are pre-matched to the student's question from their uploaded files.
- Ground your explanation in what the student's own notes say. Quote or reference specific sections to anchor your answer.
- If the relevant sections contain a formula, definition, or procedure that applies to the question, use it as your primary source — do not substitute your own version.
- Use concrete examples, analogies, and step-by-step breakdowns to explain difficult concepts.
- Ask a follow-up question if the student seems confused or hasn't given you enough context.
- If the student asks you to "just give the answer" to a test question, gently redirect: explain the underlying concept instead.
- If the topic is not in the notes and is highly specific, say so clearly and suggest they check with their instructor or textbook.
- For math topics: wrap ALL math expressions in KaTeX delimiters — inline math in $...$, display/block math in $$...$$. Example: "The derivative is $\\frac{{dy}}{{dx}} = 3t^{{2}} + 1$." Never write bare LaTeX without dollar signs.
- For coding topics: provide short code snippets in fenced code blocks with the language tag.
- Keep responses focused and well-structured. Use bullet points or numbered steps when listing multiple ideas.
- Be warm, encouraging, and treat the student as capable — never condescending.

Respond now:"""
