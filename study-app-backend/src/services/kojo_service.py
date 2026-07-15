from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.repositories.attempt_repository import AttemptRepository
from src.repositories.folder_repository import FolderRepository
from src.repositories.kojo_repository import KojoRepository
from src.schemas.kojo_schema import (
    ACTION_TYPES,
    ConversationFileDTO,
    KojoActionCardDTO,
    KojoBootstrapDTO,
    KojoChatResponse,
    KojoClearResponse,
    KojoClearedConversationDTO,
    KojoConversationDTO,
    KojoConversationSummaryDTO,
    KojoMessageDTO,
    KojoRestoreResponse,
    TestBlueprintResponse,
    GeneralChatRequest,
)
from src.services import kojo_context_cache
from src.services.file_service import FileService
from src.services.llm_service import LLMService
from src.services.rag_service import HybridRAGService
from src.utils.exceptions import LLMException, ResourceNotFoundException, ValidationException
from src.utils.latex_utils import normalize_latex
from src.utils.logger import get_logger
from typing import Optional, cast

logger = get_logger(__name__)

_NO_NOTES = "[No study materials uploaded yet. Ask the student to upload notes first.]"
_CLEAR_WINDOW_HOURS = 5
_MAP_REDUCE_NOTES_MIN_CHARS = 6000


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


def _is_long_answer_request(user_message: str) -> bool:
    message = user_message.lower()
    long_intent_phrases = [
        "explain in detail",
        "long answer",
        "compare and contrast",
        "synthesize",
        "summarize",
        "analyze",
        "walk me through",
        "step by step",
    ]
    if any(phrase in message for phrase in long_intent_phrases):
        return True
    return len(re.findall(r"[a-zA-Z]{3,}", message)) >= 18


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


_REASONING_START = "<<<REASONING>>>"
_REASONING_ANSWER = "<<<ANSWER>>>"

# Analytical / multi-step intents where a reasoning pass earns its extra tokens.
_REASONING_INTENT_PHRASES = (
    "how does", "how do", "walk me through", "step by step", "difference between",
    "compare and contrast", "show that", "work through", "break down",
    "what happens", "reason through",
)
_REASONING_INTENT_WORDS = (
    "explain", "why", "compare", "contrast", "derive", "prove", "solve",
    "calculate", "evaluate", "analyze", "analyse", "justify", "elaborate",
    "summarize", "synthesize",
)


def _reasoning_worthwhile(user_message: str) -> bool:
    """True when a prompt is complex enough that a reasoning pass helps.

    Simple lookups and short factual questions ("define osmosis", "what is the
    capital of France") skip reasoning to save tokens and latency; analytical,
    multi-step, or math prompts get it.
    """
    m = user_message.lower()
    words = re.findall(r"[a-zA-Z]{2,}", m)
    if len(words) >= 12:
        return True
    if any(phrase in m for phrase in _REASONING_INTENT_PHRASES):
        return True
    if any(re.search(rf"\b{re.escape(w)}\b", m) for w in _REASONING_INTENT_WORDS):
        return True
    # Math-ish: a digit next to an operator, or an operator next to a variable.
    if re.search(r"\d\s*[-+*/=^]\s*\w", m) or re.search(r"[-+*/=^]\s*[a-zA-Z]", m):
        return True
    return False


def _wrap_reasoning_prompt(prompt: str) -> str:
    """Append the reasoning output-format directive to a Kojo prompt.

    The model emits a short thinking pass, then the final answer, split by
    sentinel markers the streaming splitter uses to route each part to its own
    channel. The markers are ASCII sentinels the model is very unlikely to
    produce in normal prose.
    """
    return (
        f"{prompt}\n\n"
        "OUTPUT FORMAT (follow exactly):\n"
        f"1. Write the line {_REASONING_START} on its own, then 2 to 4 short sentences "
        "of your genuine thinking: what the student is really asking, what their notes say, "
        "and your plan. Keep it brief and plain.\n"
        f"2. Write the line {_REASONING_ANSWER} on its own, then give ONLY the final answer "
        "for the student, following all the response guidelines above.\n"
        f"Use {_REASONING_START} and {_REASONING_ANSWER} exactly once each, nowhere else."
    )


class _ReasoningSplitter:
    """Routes a Kojo token stream into 'reasoning' and 'answer' channels.

    Text before the ANSWER marker is reasoning; text after it is the answer.
    Handles markers that arrive split across chunks by holding back a small
    tail. If the stream ends without an ANSWER marker (model ignored the
    format), the whole output is promoted to the answer so a response is never
    lost.
    """

    def __init__(self) -> None:
        self.raw = ""
        self.in_answer = False
        self._reasoning_emitted = 0
        self._answer_emitted = 0
        self.promoted = False

    def _reasoning_visible(self) -> Optional[str]:
        """Reasoning text with the START marker stripped, or None if we should
        wait because the START marker may still be arriving."""
        idx = self.raw.find(_REASONING_START)
        if idx != -1:
            return self.raw[idx + len(_REASONING_START):]
        # START not found yet. If what we have so far is a prefix of the START
        # marker, hold everything back: the marker is still streaming in.
        stripped = self.raw.lstrip()
        if len(stripped) < len(_REASONING_START) and _REASONING_START.startswith(stripped):
            return None
        # The marker will never appear at the front: treat all as reasoning.
        return self.raw

    def feed(self, chunk: str) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        self.raw += chunk

        if not self.in_answer:
            mark_idx = self.raw.find(_REASONING_ANSWER)
            if mark_idx == -1:
                visible = self._reasoning_visible()
                if visible is None:
                    return out  # still waiting for the START marker
                # Hold back a tail that could be the start of the ANSWER marker.
                hold = len(_REASONING_ANSWER) - 1
                safe_end = max(0, len(visible) - hold)
                new = visible[self._reasoning_emitted:safe_end]
                if new:
                    out.append(("reasoning", new))
                    self._reasoning_emitted += len(new)
                return out
            # ANSWER marker found: flush remaining reasoning up to it, then switch.
            region = self.raw[:mark_idx]
            start_idx = region.find(_REASONING_START)
            visible = region[start_idx + len(_REASONING_START):] if start_idx != -1 else region
            new = visible[self._reasoning_emitted:]
            if new:
                out.append(("reasoning", new))
                self._reasoning_emitted += len(new)
            self.in_answer = True

        mark_idx = self.raw.find(_REASONING_ANSWER)
        answer_region = self.raw[mark_idx + len(_REASONING_ANSWER):]
        new = answer_region[self._answer_emitted:]
        if new:
            out.append(("answer", new))
            self._answer_emitted += len(new)
        return out

    def flush(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        if not self.in_answer:
            # No answer marker ever arrived: emit remaining reasoning, then
            # promote the whole thing to the answer so a response is never lost.
            idx = self.raw.find(_REASONING_START)
            visible = self.raw[idx + len(_REASONING_START):] if idx != -1 else self.raw
            new = visible[self._reasoning_emitted:]
            if new:
                out.append(("reasoning", new))
                self._reasoning_emitted += len(new)
            self.promoted = True
            out.append(("answer", visible))
            self._answer_emitted = len(visible)
        return out


async def _stream_answer(llm, prompt: str, provider, reasoning: bool, answer_chunks: list):
    """Stream a Kojo response, optionally splitting a reasoning pass first.

    Appends answer text to answer_chunks (so the caller can persist the final
    message) and yields {"type": "reasoning"|"delta", "text": str} events.
    """
    if reasoning:
        wrapped = _wrap_reasoning_prompt(prompt)
        splitter = _ReasoningSplitter()
        async for chunk in llm.stream_kojo(wrapped, provider=provider):
            for channel, text in splitter.feed(chunk):
                if channel == "reasoning":
                    yield {"type": "reasoning", "text": text}
                else:
                    answer_chunks.append(text)
                    yield {"type": "delta", "text": text}
        for channel, text in splitter.flush():
            if channel == "reasoning":
                yield {"type": "reasoning", "text": text}
            else:
                answer_chunks.append(text)
                yield {"type": "delta", "text": text}
    else:
        async for chunk in llm.stream_kojo(prompt, provider=provider):
            answer_chunks.append(chunk)
            yield {"type": "delta", "text": chunk}


class KojoService:
    async def create_general_conversation(
        self,
        user_id: int,
        session: AsyncSession,
    ) -> KojoConversationSummaryDTO:
        conversation = await KojoRepository(session).create_general_conversation(user_id)
        await session.commit()
        return KojoConversationSummaryDTO(
            id=conversation.id,
            name=conversation.name,
            folder_id=None,
            created_at=conversation.created_at,
        )

    async def list_general_conversations(
        self,
        user_id: int,
        session: AsyncSession,
    ) -> list[KojoConversationSummaryDTO]:
        conversations = await KojoRepository(session).list_general_conversations(user_id)
        return [
            KojoConversationSummaryDTO(id=c.id, name=c.name, folder_id=None, created_at=c.created_at)
            for c in conversations
        ]

    async def general_chat(
        self,
        user_id: int,
        conversation_id: int,
        user_message: str,
        session: AsyncSession,
        provider: Optional[str] = None,
        strictness: Optional[str] = "medium",
    ) -> KojoChatResponse:
        repo = KojoRepository(session)
        conversation = await repo.get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")

        session_files = await repo.get_conversation_files(conversation.id)
        session_files_content = "\n\n---\n\n".join(
            f"[Session upload: {f.file_name}]\n{f.content}" for f in session_files if f.content
        )
        notes_context = session_files_content if session_files_content else _NO_NOTES

        await repo.add_message(conversation.id, "user", user_message)
        history = await repo.get_history(conversation.id, limit=10, after=conversation.cleared_at)
        prompt = _build_prompt(notes_context, user_message, history, strictness=strictness or "medium")

        try:
            llm = LLMService()
            if provider:
                kojo_response = await llm.call_kojo(prompt, provider=provider)
            else:
                kojo_response = await llm.call_kojo(prompt)
        except Exception as exc:
            logger.warning("Kojo general chat LLM call failed: %s", exc)
            raise LLMException("Kojo failed to generate a response. Try again.") from exc

        kojo_msg = await repo.add_message(conversation.id, "assistant", kojo_response)

        auto_name: Optional[str] = None
        if conversation.name is None:
            raw = user_message.strip()
            auto_name = (raw[:57] + "…") if len(raw) > 60 else raw
            await repo.set_conversation_name(conversation.id, auto_name)

        await session.commit()

        return KojoChatResponse(
            response=kojo_response,
            conversation_id=conversation.id,
            message_id=kojo_msg.id,
            flagged_uncertain=False,
            conversation_name=auto_name,
        )

    async def general_chat_stream(
        self,
        user_id: int,
        conversation_id: int,
        user_message: str,
        session: AsyncSession,
        provider: Optional[str] = None,
        strictness: Optional[str] = "medium",
        reasoning: bool = False,
    ):
        """Streaming variant of general_chat.

        Yields event dicts: {"type": "delta", "text": str} as answer tokens
        arrive (and {"type": "reasoning", ...} when reasoning is enabled), then
        a final {"type": "done", ...} carrying the persisted message id and the
        normalized answer. The saved message is the answer only, identical to
        what general_chat would have stored.
        """
        repo = KojoRepository(session)
        conversation = await repo.get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")

        session_files = await repo.get_conversation_files(conversation.id)
        session_files_content = "\n\n---\n\n".join(
            f"[Session upload: {f.file_name}]\n{f.content}" for f in session_files if f.content
        )
        notes_context = session_files_content if session_files_content else _NO_NOTES

        await repo.add_message(conversation.id, "user", user_message)
        history = await repo.get_history(conversation.id, limit=10, after=conversation.cleared_at)
        prompt = _build_prompt(notes_context, user_message, history, strictness=strictness or "medium")

        llm = LLMService()
        answer_chunks: list[str] = []
        use_reasoning = reasoning and _reasoning_worthwhile(user_message)
        try:
            async for event in _stream_answer(llm, prompt, provider, use_reasoning, answer_chunks):
                yield event
        except Exception as exc:
            logger.warning("Kojo general stream LLM call failed: %s", exc)
            raise LLMException("Kojo failed to generate a response. Try again.") from exc

        kojo_response = normalize_latex("".join(answer_chunks)).strip()
        kojo_msg = await repo.add_message(conversation.id, "assistant", kojo_response)

        auto_name: Optional[str] = None
        if conversation.name is None:
            raw = user_message.strip()
            auto_name = (raw[:57] + "…") if len(raw) > 60 else raw
            await repo.set_conversation_name(conversation.id, auto_name)

        await session.commit()

        yield {
            "type": "done",
            "response": kojo_response,
            "conversation_id": conversation.id,
            "message_id": kojo_msg.id,
            "flagged_uncertain": False,
            "conversation_name": auto_name,
        }

    async def create_conversation(
        self,
        user_id: int,
        folder_id: int,
        session: AsyncSession,
    ) -> KojoConversationSummaryDTO:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        conversation = await KojoRepository(session).create_conversation(user_id, folder_id)
        await session.commit()
        return KojoConversationSummaryDTO(
            id=conversation.id,
            name=conversation.name,
            folder_id=conversation.folder_id,
            created_at=conversation.created_at,
        )

    async def list_conversations(
        self,
        user_id: int,
        folder_id: int,
        session: AsyncSession,
    ) -> list[KojoConversationSummaryDTO]:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        conversations = await KojoRepository(session).list_conversations_by_folder(user_id, folder_id)
        return [
            KojoConversationSummaryDTO(id=c.id, name=c.name, folder_id=c.folder_id, created_at=c.created_at)
            for c in conversations
        ]

    def _conversation_dto(self, conversation) -> KojoConversationDTO:
        """Build a conversation DTO, hiding messages from before a clear."""
        visible_messages = conversation.messages
        if conversation.cleared_at is not None:
            visible_messages = [
                msg for msg in conversation.messages if msg.created_at > conversation.cleared_at
            ]
        return KojoConversationDTO(
            id=conversation.id,
            folder_id=conversation.folder_id,
            messages=[
                KojoMessageDTO(id=m.id, role=m.role, content=m.content, created_at=m.created_at)
                for m in visible_messages
            ],
            created_at=conversation.created_at,
            cleared_at=conversation.cleared_at,
        )

    def _files_dto(self, files) -> list[ConversationFileDTO]:
        return [
            ConversationFileDTO(
                id=f.id,
                file_name=f.file_name,
                file_type=f.file_type,
                size_bytes=f.size_bytes,
                uploaded_at=f.uploaded_at,
            )
            for f in files
        ]

    async def bootstrap_folder(
        self,
        user_id: int,
        folder_id: int,
        session: AsyncSession,
    ) -> KojoBootstrapDTO:
        """Single-round-trip initial load for a folder's chat screen.

        Returns the folder's conversation list plus the most recent
        conversation's messages and session files, so the frontend no longer
        chains list -> by-id -> files as three sequential network calls.
        """
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        # Warm the folder context in the background so the first chat message
        # doesn't pay the notes + files assembly cost on top of the LLM call.
        kojo_context_cache.schedule_warm(folder_id, user_id)
        repo = KojoRepository(session)
        conversations = await repo.list_conversations_by_folder(user_id, folder_id)
        if not conversations:
            fresh = await repo.create_conversation(user_id, folder_id)
            await session.commit()
            return self._fresh_bootstrap(fresh, folder_id=fresh.folder_id)
        return await self._bootstrap_from(repo, conversations, user_id)

    async def bootstrap_general(
        self,
        user_id: int,
        session: AsyncSession,
    ) -> KojoBootstrapDTO:
        """Single-round-trip initial load for the General (no folder) chat."""
        repo = KojoRepository(session)
        conversations = await repo.list_general_conversations(user_id)
        if not conversations:
            fresh = await repo.create_general_conversation(user_id)
            await session.commit()
            return self._fresh_bootstrap(fresh, folder_id=None)
        return await self._bootstrap_from(repo, conversations, user_id)

    def _fresh_bootstrap(self, conversation, folder_id) -> KojoBootstrapDTO:
        summary = KojoConversationSummaryDTO(
            id=conversation.id,
            name=conversation.name,
            folder_id=folder_id,
            created_at=conversation.created_at,
        )
        active = KojoConversationDTO(
            id=conversation.id,
            folder_id=folder_id,
            messages=[],
            created_at=conversation.created_at,
            cleared_at=conversation.cleared_at,
        )
        return KojoBootstrapDTO(conversations=[summary], active=active, files=[])

    async def _bootstrap_from(
        self, repo: KojoRepository, conversations: list, user_id: int
    ) -> KojoBootstrapDTO:
        summaries = [
            KojoConversationSummaryDTO(
                id=c.id, name=c.name, folder_id=c.folder_id, created_at=c.created_at
            )
            for c in conversations
        ]
        latest_id = conversations[0].id
        active_conv = await repo.get_conversation_by_id(latest_id, user_id)
        active = self._conversation_dto(active_conv) if active_conv else None
        files = self._files_dto(await repo.get_conversation_files(latest_id))
        return KojoBootstrapDTO(conversations=summaries, active=active, files=files)

    async def chat(
        self,
        user_id: int,
        folder_id: int,
        user_message: str,
        session: AsyncSession,
        provider: Optional[str] = None,
        strictness: Optional[str] = "medium",
        conversation_id: Optional[int] = None,
    ) -> KojoChatResponse:
        repo = KojoRepository(session)

        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        if conversation_id is not None:
            conversation = await repo.get_conversation_by_id(conversation_id, user_id)
            if conversation is None:
                raise ResourceNotFoundException("Conversation")
        else:
            conversation = await repo.get_or_create_conversation(user_id, folder_id)

        # Folder-level context (notes + folder files) is cached across chat
        # turns; only the conversation-scoped session files are read live.
        folder_context, cache_hit = await kojo_context_cache.get_folder_context(
            folder_id, user_id, session
        )
        session_files = await repo.get_conversation_files(conversation.id)
        session_files_content = "\n\n---\n\n".join(
            f"[Session upload: {f.file_name}]\n{f.content}" for f in session_files if f.content
        )
        logger.info(
            "Folder context loaded for Kojo chat",
            extra={
                "user_id": user_id,
                "folder_id": folder_id,
                "folder_context_length": len(folder_context),
                "context_cache_hit": cache_hit,
                "session_files_count": len(session_files),
            }
        )
        context_parts = [part for part in (folder_context, session_files_content) if part]
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
            prompt = _build_prompt(notes_context, user_message, history, strictness=strictness or "medium")

        active_provider = provider

        try:
            llm = LLMService()
            kojo_strictness = _normalize_strictness(strictness)
            use_map_reduce = (
                notes_context != _NO_NOTES
                and len(notes_context) >= _MAP_REDUCE_NOTES_MIN_CHARS
                and _is_long_answer_request(user_message)
                and not _is_review_wrong_answers_request(user_message)
            )
            if use_map_reduce:
                history_block = _build_history_block(history)
                kojo_response = await llm.map_reduce_long_answer(
                    notes=notes_context,
                    user_query=user_message,
                    history_block=history_block,
                    provider=active_provider,
                    strictness=kojo_strictness,
                )
            elif active_provider:
                kojo_response = await llm.call_kojo(prompt if isinstance(prompt, str) else str(prompt), provider=active_provider)
            else:
                kojo_response = await llm.call_kojo(prompt if isinstance(prompt, str) else str(prompt))
        except Exception as exc:
            logger.warning("Kojo LLM call failed: %s", exc)
            raise LLMException("Kojo failed to generate a response. Try again.") from exc

        flagged = (
            "can't help" in kojo_response.lower()
            or "cannot help" in kojo_response.lower()
            or "not covered in your" in kojo_response.lower()
        )

        kojo_msg = await repo.add_message(conversation.id, "assistant", kojo_response)

        # Auto-name the conversation from the first user message
        auto_name: Optional[str] = None
        if conversation.name is None:
            raw = user_message.strip()
            auto_name = (raw[:57] + "…") if len(raw) > 60 else raw
            await repo.set_conversation_name(conversation.id, auto_name)

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
            conversation_name=auto_name,
        )

    async def chat_stream(
        self,
        user_id: int,
        folder_id: int,
        user_message: str,
        session: AsyncSession,
        provider: Optional[str] = None,
        strictness: Optional[str] = "medium",
        conversation_id: Optional[int] = None,
        reasoning: bool = False,
    ):
        """Streaming variant of chat().

        Yields {"type": "delta", "text": str} events as tokens arrive, then a
        {"type": "done", ...} event. The persisted assistant message is
        identical to the non-streamed path. The map-reduce long-answer path and
        the "no wrong answers" early return are not token-streamed (they have no
        single underlying stream); they emit their full text as one delta so the
        frontend consumes every entry point through the same code path.
        """
        repo = KojoRepository(session)

        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        if conversation_id is not None:
            conversation = await repo.get_conversation_by_id(conversation_id, user_id)
            if conversation is None:
                raise ResourceNotFoundException("Conversation")
        else:
            conversation = await repo.get_or_create_conversation(user_id, folder_id)

        folder_context, cache_hit = await kojo_context_cache.get_folder_context(
            folder_id, user_id, session
        )
        session_files = await repo.get_conversation_files(conversation.id)
        session_files_content = "\n\n---\n\n".join(
            f"[Session upload: {f.file_name}]\n{f.content}" for f in session_files if f.content
        )
        context_parts = [part for part in (folder_context, session_files_content) if part]
        notes_context = "\n\n---\n\n".join(context_parts) if context_parts else _NO_NOTES

        # Prebuilt full text for the non-token-streamed branches.
        prebuilt: Optional[str] = None
        prompt: Optional[str] = None

        if _is_review_wrong_answers_request(user_message):
            wrong_answers_result = await AttemptRepository(session).get_recent_wrong_answers(user_id)
            if wrong_answers_result:
                _attempt, wrong_answers_data = wrong_answers_result
                await repo.add_message(conversation.id, "user", user_message)
                history = await repo.get_history(conversation.id, limit=10, after=conversation.cleared_at)
                wrong_answers_context = _format_wrong_answers_context(wrong_answers_data)
                prompt = _build_review_wrong_answers_prompt(notes_context, wrong_answers_context, user_message, history)
            else:
                await repo.add_message(conversation.id, "user", user_message)
                prebuilt = "You don't have any wrong answers from your most recent test to review. Keep practicing!"
        else:
            await repo.add_message(conversation.id, "user", user_message)
            history = await repo.get_history(conversation.id, limit=10, after=conversation.cleared_at)
            prompt = _build_prompt(notes_context, user_message, history, strictness=strictness or "medium")

        llm = LLMService()
        kojo_strictness = _normalize_strictness(strictness)
        use_map_reduce = (
            prebuilt is None
            and notes_context != _NO_NOTES
            and len(notes_context) >= _MAP_REDUCE_NOTES_MIN_CHARS
            and _is_long_answer_request(user_message)
            and not _is_review_wrong_answers_request(user_message)
        )

        answer_chunks: list[str] = []
        try:
            if prebuilt is not None:
                # Fixed string (no wrong answers to review); not token-streamed.
                kojo_response = prebuilt
                yield {"type": "delta", "text": prebuilt}
            elif use_map_reduce:
                # Multi-call synthesis has no single stream; emit as one delta.
                history_block = _build_history_block(history)
                full = await llm.map_reduce_long_answer(
                    notes=notes_context,
                    user_query=user_message,
                    history_block=history_block,
                    provider=provider,
                    strictness=kojo_strictness,
                )
                kojo_response = full
                yield {"type": "delta", "text": full}
            else:
                use_reasoning = reasoning and _reasoning_worthwhile(user_message)
                async for event in _stream_answer(llm, str(prompt), provider, use_reasoning, answer_chunks):
                    yield event
                kojo_response = normalize_latex("".join(answer_chunks)).strip()
        except Exception as exc:
            logger.warning("Kojo stream LLM call failed: %s", exc)
            raise LLMException("Kojo failed to generate a response. Try again.") from exc

        flagged = (
            "can't help" in kojo_response.lower()
            or "cannot help" in kojo_response.lower()
            or "not covered in your" in kojo_response.lower()
        )

        kojo_msg = await repo.add_message(conversation.id, "assistant", kojo_response)

        auto_name: Optional[str] = None
        if conversation.name is None:
            raw = user_message.strip()
            auto_name = (raw[:57] + "…") if len(raw) > 60 else raw
            await repo.set_conversation_name(conversation.id, auto_name)

        await session.commit()

        logger.info(
            "Kojo chat stream completed",
            extra={"user_id": user_id, "conversation_id": conversation.id, "context_cache_hit": cache_hit},
        )

        yield {
            "type": "done",
            "response": kojo_response,
            "conversation_id": conversation.id,
            "message_id": kojo_msg.id,
            "flagged_uncertain": flagged,
            "conversation_name": auto_name,
        }

    async def get_conversation_detail(
        self,
        user_id: int,
        conversation_id: int,
        session: AsyncSession,
    ) -> KojoConversationDTO:
        conversation = await KojoRepository(session).get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")
        visible_messages = conversation.messages
        if conversation.cleared_at is not None:
            visible_messages = [msg for msg in conversation.messages if msg.created_at > conversation.cleared_at]
        return KojoConversationDTO(
            id=conversation.id,
            folder_id=conversation.folder_id,
            messages=[
                KojoMessageDTO(id=m.id, role=m.role, content=m.content, created_at=m.created_at)
                for m in visible_messages
            ],
            created_at=conversation.created_at,
            cleared_at=conversation.cleared_at,
        )

    async def delete_conversation(
        self,
        user_id: int,
        conversation_id: int,
        session: AsyncSession,
    ) -> None:
        deleted = await KojoRepository(session).delete_conversation(conversation_id, user_id)
        if not deleted:
            raise ResourceNotFoundException("Conversation")
        await session.commit()

    async def rename_conversation(
        self,
        user_id: int,
        conversation_id: int,
        name: str,
        session: AsyncSession,
    ) -> KojoConversationSummaryDTO:
        conversation = await KojoRepository(session).rename_conversation(
            conversation_id, user_id, name.strip()
        )
        if conversation is None:
            raise ResourceNotFoundException("Conversation")
        await session.commit()
        return KojoConversationSummaryDTO.model_validate(conversation)

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

        await repo.delete_conversation_files(conversation.id)
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

    async def _do_upload_files(
        self,
        repo: KojoRepository,
        conversation_id: int,
        files: list,
        session: AsyncSession,
    ) -> list[ConversationFileDTO]:
        svc = FileService()
        results: list[ConversationFileDTO] = []
        for upload in files:
            data = await upload.read()
            async def _async_read(self, d=data):
                return d
            mock = cast(
                UploadFile,
                type("_F", (), {"read": _async_read, "seek": lambda self, p: None, "filename": upload.filename or "file"})(),
            )
            content, _ = await svc.extract_from_files([mock])
            cf = await repo.add_conversation_file(
                conversation_id=conversation_id,
                file_name=upload.filename or "file",
                file_type=getattr(upload, "content_type", "") or "",
                size_bytes=len(data),
                content=content,
            )
            results.append(ConversationFileDTO(
                id=cf.id,
                file_name=cf.file_name,
                file_type=cf.file_type,
                size_bytes=cf.size_bytes,
                uploaded_at=cf.uploaded_at,
            ))
        await session.commit()
        return results

    async def upload_conversation_files_by_id(
        self,
        user_id: int,
        conversation_id: int,
        files: list,
        session: AsyncSession,
    ) -> list[ConversationFileDTO]:
        repo = KojoRepository(session)
        conversation = await repo.get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")
        return await self._do_upload_files(repo, conversation.id, files, session)

    async def list_conversation_files_by_id(
        self,
        user_id: int,
        conversation_id: int,
        session: AsyncSession,
    ) -> list[ConversationFileDTO]:
        repo = KojoRepository(session)
        conversation = await repo.get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")
        files = await repo.get_conversation_files(conversation.id)
        return [
            ConversationFileDTO(id=f.id, file_name=f.file_name, file_type=f.file_type, size_bytes=f.size_bytes, uploaded_at=f.uploaded_at)
            for f in files
        ]

    async def delete_conversation_file_by_id(
        self,
        user_id: int,
        conversation_id: int,
        file_id: int,
        session: AsyncSession,
    ) -> None:
        repo = KojoRepository(session)
        conversation = await repo.get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")
        cf = await repo.get_conversation_file_owned(file_id, conversation.id)
        if cf is None:
            raise ResourceNotFoundException("ConversationFile")
        await session.delete(cf)
        await session.commit()

    async def upload_conversation_files(
        self,
        user_id: int,
        folder_id: int,
        files: list,
        session: AsyncSession,
    ) -> list[ConversationFileDTO]:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")
        repo = KojoRepository(session)
        conversation = await repo.get_or_create_conversation(user_id, folder_id)
        return await self._do_upload_files(repo, conversation.id, files, session)

    async def list_conversation_files(
        self,
        user_id: int,
        folder_id: int,
        session: AsyncSession,
    ) -> list[ConversationFileDTO]:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        repo = KojoRepository(session)
        conversation = await repo.get_or_create_conversation(user_id, folder_id)
        files = await repo.get_conversation_files(conversation.id)
        return [
            ConversationFileDTO(
                id=f.id,
                file_name=f.file_name,
                file_type=f.file_type,
                size_bytes=f.size_bytes,
                uploaded_at=f.uploaded_at,
            )
            for f in files
        ]

    async def delete_conversation_file(
        self,
        user_id: int,
        folder_id: int,
        file_id: int,
        session: AsyncSession,
    ) -> None:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        repo = KojoRepository(session)
        conversation = await repo.get_or_create_conversation(user_id, folder_id)
        cf = await repo.get_conversation_file_owned(file_id, conversation.id)
        if cf is None:
            raise ResourceNotFoundException("ConversationFile")

        await session.delete(cf)
        await session.commit()

    async def propose_test_blueprint(
        self,
        user_id: int,
        folder_id: int,
        user_message: str,
        session: AsyncSession,
        provider: Optional[str] = None,
    ) -> TestBlueprintResponse:
        folder = await FolderRepository(session).get_owned(folder_id, user_id)
        if folder is None:
            raise ResourceNotFoundException("Folder")

        # Same folder-level context (and cache) as chat().
        notes_context, _ = await kojo_context_cache.get_folder_context(
            folder_id, user_id, session
        )

        result = await LLMService().generate_test_blueprint(
            user_message=user_message,
            notes_context=notes_context,
            provider=provider,
        )
        return TestBlueprintResponse(**result)

    # ── Action cards (chat-proposed creations) ──────────────────────────────

    def _action_card_dto(self, card, entity_deleted: bool = False) -> KojoActionCardDTO:
        try:
            payload = json.loads(card.payload_json or "{}")
        except (TypeError, ValueError):
            payload = {}
        return KojoActionCardDTO(
            id=card.id,
            conversation_id=card.conversation_id,
            message_id=card.message_id,
            action_type=card.action_type,
            status=card.status,
            payload=payload,
            entity_type=card.entity_type,
            entity_id=card.entity_id,
            entity_deleted=entity_deleted,
            created_at=card.created_at,
            resolved_at=card.resolved_at,
        )

    async def propose_action(
        self,
        user_id: int,
        conversation_id: int,
        action_type: str,
        user_message: str,
        session: AsyncSession,
        provider: Optional[str] = None,
        message_id: Optional[int] = None,
    ) -> KojoActionCardDTO:
        if action_type not in ACTION_TYPES:
            raise ValidationException(f"Unknown action type: {action_type}")
        repo = KojoRepository(session)
        conversation = await repo.get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")

        if action_type == "start_matching":
            # Pure navigation: no LLM extraction needed, the card just needs
            # a folder pick (frontend) and an intro line.
            payload = {"intro": "Ready to practice? Pick a folder with flashcards and I'll start matching mode."}
        else:
            history = await repo.get_history(
                conversation.id, limit=10, after=conversation.cleared_at
            )
            history_block = _build_history_block(history)
            try:
                payload = await LLMService().generate_action_proposal(
                    action_type=action_type,
                    user_message=user_message,
                    history_block=history_block,
                    provider=provider,
                )
            except Exception as exc:
                logger.warning("Kojo action proposal LLM call failed: %s", exc)
                raise LLMException("Kojo couldn't draft that plan. Try again.") from exc

        card = await repo.add_action_card(
            conversation_id=conversation.id,
            action_type=action_type,
            payload_json=json.dumps(payload),
            message_id=message_id,
        )
        await session.commit()
        return self._action_card_dto(card)

    async def _entity_deleted(self, card, user_id: int, session: AsyncSession) -> bool:
        """True when a confirmed card's created entity no longer exists."""
        if card.status != "confirmed" or card.entity_type is None or card.entity_id is None:
            return False
        from sqlalchemy import select

        from src.models.flashcard import Flashcard
        from src.models.folder import Folder
        from src.models.learning_module import LearningTrack

        if card.entity_type == "folder":
            folder = await session.scalar(
                select(Folder.id).where(Folder.id == card.entity_id, Folder.user_id == user_id)
            )
            return folder is None
        if card.entity_type == "learning_track":
            track = await session.scalar(
                select(LearningTrack.id).where(LearningTrack.id == card.entity_id)
            )
            return track is None
        if card.entity_type == "flashcards":
            # entity_id is the folder; the payload carries the generated card ids.
            try:
                payload = json.loads(card.payload_json or "{}")
                ids = [int(i) for i in payload.get("flashcard_ids", [])]
            except (TypeError, ValueError):
                ids = []
            if not ids:
                folder = await session.scalar(
                    select(Folder.id).where(Folder.id == card.entity_id, Folder.user_id == user_id)
                )
                return folder is None
            remaining = await session.scalar(
                select(Flashcard.id).where(Flashcard.id.in_(ids)).limit(1)
            )
            return remaining is None
        return False

    async def list_action_cards(
        self,
        user_id: int,
        conversation_id: int,
        session: AsyncSession,
    ) -> list[KojoActionCardDTO]:
        repo = KojoRepository(session)
        conversation = await repo.get_conversation_by_id(conversation_id, user_id)
        if conversation is None:
            raise ResourceNotFoundException("Conversation")
        cards = await repo.get_action_cards(conversation.id)
        if conversation.cleared_at is not None:
            cards = [c for c in cards if c.created_at > conversation.cleared_at]
        return [
            self._action_card_dto(c, entity_deleted=await self._entity_deleted(c, user_id, session))
            for c in cards
        ]

    async def resolve_action(
        self,
        user_id: int,
        card_id: int,
        status: str,
        session: AsyncSession,
        entity_type: Optional[str] = None,
        entity_id: Optional[int] = None,
        payload_update: Optional[dict] = None,
    ) -> KojoActionCardDTO:
        if status not in {"confirmed", "dismissed"}:
            raise ValidationException("status must be 'confirmed' or 'dismissed'")
        repo = KojoRepository(session)
        card = await repo.get_action_card_owned(card_id, user_id)
        if card is None:
            raise ResourceNotFoundException("ActionCard")
        card.status = status
        card.resolved_at = datetime.utcnow()
        if entity_type is not None:
            card.entity_type = entity_type
        if entity_id is not None:
            card.entity_id = entity_id
        if payload_update:
            try:
                payload = json.loads(card.payload_json or "{}")
            except (TypeError, ValueError):
                payload = {}
            payload.update(payload_update)
            card.payload_json = json.dumps(payload)
        await session.commit()
        return self._action_card_dto(card)

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
                    folder_name=(
                        conv.folder.name if conv.folder is not None
                        else "General chat" if conv.folder_id is None
                        else f"Folder {conv.folder_id}"
                    ),
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
    context, meta = HybridRAGService().retrieve_context(notes, user_message, top_k=max_sections)
    if context and meta.get("retrieval_selected_chunks", 0):
        return context

    keywords = [
        w for w in re.findall(r"[a-zA-Z]{3,}", user_message.lower())
        if w not in _STOPWORDS
    ]
    # Capture digit sequences so "question 7" can find the paragraph containing "7."
    number_tokens = re.findall(r"\d+", user_message)

    if not keywords and not number_tokens:
        return ""

    # Split on blank lines or section separators into meaningful chunks
    raw_chunks = re.split(r"\n{2,}|(?:^|\n)---+(?:\n|$)", notes)
    paragraphs = [c.strip() for c in raw_chunks if len(c.strip()) > 40]

    scored: list[tuple[int, str]] = []
    for para in paragraphs:
        para_lower = para.lower()
        score = sum(1 for kw in keywords if kw in para_lower)
        # Boost paragraphs that explicitly reference the queried question number
        # (e.g. "7." or "7)" at a word boundary), so "question 7" finds the right chunk.
        for num in number_tokens:
            if re.search(rf"(?<!\d){re.escape(num)}[.):]", para):
                score += 2
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
        doc_sources = _list_document_sources(notes)
        doc_inventory = (
            f"UPLOADED DOCUMENTS ({len(doc_sources)}): {', '.join(doc_sources)}\n\n"
            if len(doc_sources) > 1 else ""
        )
        relevant = _extract_relevant_sections(notes, wrong_answers)
        relevant_block = (
            "RELEVANT SECTIONS FROM STUDENT'S NOTES (pre-matched to their answers):\n"
            f"{relevant}\n\n"
            if relevant else
            "NOTE: No closely matching sections found in their notes for these answers.\n\n"
        )
        notes_block = (
            f"{doc_inventory}"
            f"{relevant_block}"
            f"FULL STUDENT NOTES AND FOLDER FILES:\n{notes[:25000]}"
        )
    else:
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


def _list_document_sources(notes_context: str) -> list[str]:
    """Extract document names from the assembled notes context (reads [filename] markers)."""
    sources: list[str] = []
    seen: set[str] = set()
    for line in notes_context.splitlines():
        stripped = line.strip()
        m = re.match(r"^\[(.+?)\]\s*$", stripped)
        if m:
            name = m.group(1).strip()
            if name not in seen:
                sources.append(name)
                seen.add(name)
    return sources


def _normalize_strictness(strictness: Optional[str]) -> str:
    normalized = (strictness or "medium").strip().lower()
    return normalized if normalized in {"strict", "medium", "none"} else "medium"


def _build_prompt(notes: str, user_message: str, history: list, strictness: str = "medium") -> str:
    history_lines: list[str] = []
    for msg in history[:-1]:
        role_label = "Student" if msg.role == "user" else "Kojo"
        history_lines.append(f"{role_label}: {msg.content}")
    history_block = "\n\nCONVERSATION SO FAR:\n" + "\n".join(history_lines) if history_lines else ""

    has_notes = notes != _NO_NOTES

    if has_notes:
        doc_sources = _list_document_sources(notes)
        doc_inventory = (
            f"UPLOADED DOCUMENTS ({len(doc_sources)}): {', '.join(doc_sources)}\n\n"
            if len(doc_sources) > 1 else ""
        )
        relevant = _extract_relevant_sections(notes, user_message)
        relevant_block = (
            "RELEVANT SECTIONS FROM STUDENT'S NOTES (pre-matched to their question):\n"
            f"{relevant}\n\n"
            if relevant else
            "RELEVANT SECTIONS: [No closely matching sections found — use the full notes below.]\n\n"
        )
        notes_block = (
            f"{doc_inventory}"
            f"{relevant_block}"
            f"FULL STUDENT NOTES AND FOLDER FILES:\n{notes[:25000]}"
        )
    else:
        notes_block = (
            "NOTE: The student has not uploaded any study materials yet. "
            "You can still answer general questions, but encourage them to upload notes for personalized help."
        )

    strictness = _normalize_strictness(strictness)

    if strictness == "strict":
        constitution = """RESPONSE GUIDELINES (STRICT — stay within the student's notes):
- Only answer from what is explicitly in the student's uploaded notes and files above.
- If the topic is NOT covered in the notes, say: "I don't see this in your notes — check with your instructor or textbook."
- Do NOT draw on general knowledge to fill gaps, even if you know the answer.
- Quote or reference specific note sections to anchor every claim.
- For math: wrap expressions in KaTeX ($...$ inline, $$...$$ display).
- For code: use fenced code blocks with language tag.
- Be warm and encouraging, but don't go beyond the notes."""
    elif strictness == "none":
        constitution = """RESPONSE GUIDELINES (OPEN — answer freely):
- Answer the student's question as thoroughly as possible using your full knowledge.
- You may use the student's notes as helpful context, but you are not limited to them.
- If your answer goes beyond what's in their notes, tell the student to fact-check it: "This is from my general knowledge — verify with your course materials."
- Use concrete examples, analogies, and step-by-step explanations.
- For math: wrap expressions in KaTeX ($...$ inline, $$...$$ display).
- For code: use fenced code blocks with language tag.
- Be warm, encouraging, and thorough."""
    else:  # medium (default)
        constitution = """RESPONSE GUIDELINES:
- Check the RELEVANT SECTIONS first — they are pre-matched to the student's question.
- Ground your answer in the student's notes where possible; quote specific sections when relevant.
- If the notes don't fully cover the topic, fill the gap with your general knowledge — but flag it: "This part isn't in your notes, but generally speaking…"
- Use concrete examples, analogies, and step-by-step breakdowns.
- Ask a follow-up question if the student seems confused or needs more context.
- For math: wrap ALL expressions in KaTeX ($...$ inline, $$...$$ display).
- For code: use fenced code blocks with language tag.
- Keep responses focused and well-structured. Be warm and encouraging."""

    return f"""You are Kojo, an intelligent and supportive AI study companion built into Nosey, a study tool.
Your role is to help students genuinely understand their course material — not to give them answers to memorize.

{notes_block}
{history_block}

STUDENT'S MESSAGE: {user_message}

{constitution}

Respond now:"""


def _build_history_block(history: list) -> str:
    history_lines: list[str] = []
    for msg in history[:-1]:
        role_label = "Student" if msg.role == "user" else "Kojo"
        history_lines.append(f"{role_label}: {msg.content}")
    if not history_lines:
        return ""
    return "CONVERSATION SO FAR:\n" + "\n".join(history_lines)
