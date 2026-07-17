from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.flashcard import FlashcardAttempt
from src.models.folder import Folder
from src.models.kojo_conversation import KojoConversation
from src.models.kojo_message import KojoMessage
from src.models.test import Test
from src.models.user_attempt import UserAttempt
from src.models.user_memory import UserMemory
from src.repositories.user_memory_repository import UserMemoryRepository
from src.services.llm_service import LLMService
from src.utils.logger import get_logger

logger = get_logger(__name__)

# How long a memory stays fresh before it is regenerated from newer activity.
REFRESH_DAYS = 7
# Cap the stored recap so it can't bloat the chat prompt it later feeds.
_MAX_CONTENT_CHARS = 800


def is_stale(memory: Optional[UserMemory]) -> bool:
    if memory is None or memory.generated_at is None:
        return True
    return memory.generated_at < datetime.utcnow() - timedelta(days=REFRESH_DAYS)


class MemoryService:
    """Builds and stores the weekly per-user study memory.

    Stateless and instantiated per request, like the other services. Never talks
    to more than one provider chain per call (the single summarization LLM call),
    keeping it within the project's provider-fallback rules.
    """

    async def _collect_activity(self, user_id: int, session: AsyncSession) -> dict:
        since = datetime.utcnow() - timedelta(days=REFRESH_DAYS)

        test_rows = (
            await session.execute(
                select(Test.title, UserAttempt.correct_count, UserAttempt.total_questions)
                .join(Test, Test.id == UserAttempt.test_id)
                .where(
                    UserAttempt.user_id == user_id,
                    UserAttempt.status == "submitted",
                    UserAttempt.created_at >= since,
                )
                .order_by(UserAttempt.created_at.desc())
                .limit(10)
            )
        ).all()

        flashcard_count = (
            await session.execute(
                select(func.count())
                .select_from(FlashcardAttempt)
                .where(
                    FlashcardAttempt.user_id == user_id,
                    FlashcardAttempt.created_at >= since,
                )
            )
        ).scalar() or 0

        chat_rows = (
            await session.execute(
                select(KojoMessage.content)
                .join(KojoConversation, KojoConversation.id == KojoMessage.conversation_id)
                .where(
                    KojoConversation.user_id == user_id,
                    KojoMessage.role == "user",
                    KojoMessage.created_at >= since,
                )
                .order_by(KojoMessage.created_at.desc())
                .limit(8)
            )
        ).all()

        folder_rows = (
            await session.execute(
                select(Folder.name, Folder.subject)
                .where(Folder.user_id == user_id, Folder.is_archived.is_(False))
                .order_by(Folder.updated_at.desc())
                .limit(12)
            )
        ).all()

        return {
            "tests": [
                {
                    "title": r[0],
                    "correct": r[1],
                    "total": r[2],
                }
                for r in test_rows
            ],
            "flashcard_count": int(flashcard_count),
            "chat_topics": [str(r[0])[:160] for r in chat_rows if r[0]],
            "folders": [
                {"name": r[0], "subject": r[1]} for r in folder_rows
            ],
        }

    def _has_activity(self, activity: dict) -> bool:
        return bool(
            activity["tests"] or activity["flashcard_count"] or activity["chat_topics"]
        )

    def _activity_brief(self, activity: dict) -> str:
        lines: list[str] = []
        if activity["folders"]:
            names = ", ".join(
                f"{f['name']}" + (f" ({f['subject']})" if f["subject"] else "")
                for f in activity["folders"][:8]
            )
            lines.append(f"Study folders: {names}")
        if activity["tests"]:
            parts = []
            for t in activity["tests"]:
                if t["correct"] is not None and t["total"]:
                    parts.append(f"{t['title']} ({t['correct']}/{t['total']})")
                else:
                    parts.append(str(t["title"]))
            lines.append(f"Practice tests taken this week: {', '.join(parts)}")
        if activity["flashcard_count"]:
            lines.append(f"Flashcards reviewed this week: {activity['flashcard_count']}")
        if activity["chat_topics"]:
            topics = "; ".join(activity["chat_topics"][:6])
            lines.append(f"Recent questions asked to Kojo: {topics}")
        return "\n".join(lines)

    def _fallback_summary(self, activity: dict) -> str:
        """A templated recap used when the LLM is unavailable, so the memory
        feature degrades gracefully instead of failing."""
        bits: list[str] = []
        if activity["tests"]:
            bits.append(f"took {len(activity['tests'])} practice test(s)")
        if activity["flashcard_count"]:
            bits.append(f"reviewed {activity['flashcard_count']} flashcard(s)")
        if activity["chat_topics"]:
            bits.append(f"asked Kojo {len(activity['chat_topics'])} question(s)")
        if not bits:
            return ""
        return "This week you " + ", ".join(bits) + "."

    async def _summarize(self, activity: dict, provider: Optional[str]) -> str:
        brief = self._activity_brief(activity)
        prompt = (
            "You are writing a short study memory for a student, so their AI tutor can remember "
            "what they've been working on. Using only the activity below, write 2 to 3 short "
            "sentences in second person (\"You've been ...\") summarizing what the student has been "
            "studying this week and any patterns worth noting. Be specific and encouraging. Do not "
            "invent anything that isn't in the data. Output only the summary, with no preamble.\n\n"
            f"THIS WEEK'S ACTIVITY:\n{brief}"
        )
        try:
            llm = LLMService()
            text = await llm.call_kojo(prompt, provider=provider) if provider else await llm.call_kojo(prompt)
            cleaned = (text or "").strip()
            return cleaned[:_MAX_CONTENT_CHARS] if cleaned else self._fallback_summary(activity)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Memory summarization failed, using fallback: %s", exc)
            return self._fallback_summary(activity)

    async def get(self, user_id: int, session: AsyncSession) -> Optional[UserMemory]:
        return await UserMemoryRepository(session).get(user_id)

    async def ensure_fresh(
        self,
        user_id: int,
        session: AsyncSession,
        provider: Optional[str] = None,
        force: bool = False,
    ) -> UserMemory:
        """Return the user's memory, regenerating it first if it is stale (or if
        force is set). Cheap when fresh: a single indexed read, no LLM call."""
        repo = UserMemoryRepository(session)
        existing = await repo.get(user_id)
        if existing is not None and not is_stale(existing) and not force:
            return existing

        activity = await self._collect_activity(user_id, session)
        content = await self._summarize(activity, provider) if self._has_activity(activity) else ""
        memory = await repo.upsert(user_id, content=content, generated_at=datetime.utcnow())
        await session.commit()
        logger.info("User memory regenerated", extra={"user_id": user_id, "had_activity": self._has_activity(activity)})
        return memory
