from __future__ import annotations

from sqlalchemy import Select, case, delete, func, select

from src.models.flashcard import Flashcard, FlashcardAttempt
from src.repositories.base_repository import BaseRepository
from typing import Optional


class FlashcardRepository(BaseRepository[Flashcard]):
    async def create(self, folder_id: int, front: str, back: str, source: Optional[str]) -> Flashcard:
        flashcard = Flashcard(folder_id=folder_id, front=front, back=back, source=source)
        self.session.add(flashcard)
        await self.session.flush()
        return flashcard

    async def get(self, flashcard_id: int) -> Optional[Flashcard]:
        return await self.session.scalar(select(Flashcard).where(Flashcard.id == flashcard_id))

    async def update(self, card: Flashcard, front: str, back: str) -> Flashcard:
        card.front = front
        card.back = back
        await self.session.flush()
        return card

    async def delete(self, card: Flashcard) -> None:
        await self.session.delete(card)

    async def delete_all_in_folder(self, folder_id: int) -> int:
        """Bulk-delete every card in a folder in one statement.

        Attempts are removed by the DB-level ON DELETE CASCADE on
        flashcard_attempts.flashcard_id, so this stays a single round-trip
        instead of N per-card DELETE calls from the client.
        """
        stmt = (
            delete(Flashcard)
            .where(Flashcard.folder_id == folder_id)
            .execution_options(synchronize_session=False)
        )
        result = await self.session.execute(stmt)
        return result.rowcount or 0

    async def list_with_stats(
        self,
        folder_id: int,
        user_id: int,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> list[tuple[Flashcard, int, int, Optional[float], object]]:
        correct_count = func.sum(case((FlashcardAttempt.correct.is_(True), 1), else_=0))
        total_count = func.count(FlashcardAttempt.id)
        stmt: Select[tuple[Flashcard, int, int, Optional[float], object]] = (
            select(
                Flashcard,
                total_count.label("attempt_count"),
                correct_count.label("correct_count"),
                (correct_count / func.nullif(total_count, 0)).label("success_rate"),
                func.max(FlashcardAttempt.created_at).label("last_attempted"),
            )
            .outerjoin(
                FlashcardAttempt,
                (FlashcardAttempt.flashcard_id == Flashcard.id)
                & (FlashcardAttempt.user_id == user_id),
            )
            .where(Flashcard.folder_id == folder_id)
            .group_by(Flashcard.id)
            .order_by(Flashcard.created_at.desc())
        )
        if offset is not None:
            stmt = stmt.offset(offset)
        if limit is not None:
            stmt = stmt.limit(limit)
        rows = await self.session.execute(stmt)
        return list(rows.all())

    async def list_with_stats_for_user(self, user_id: int) -> list[tuple[Flashcard, int, int, Optional[float], object]]:
        correct_count = func.sum(case((FlashcardAttempt.correct.is_(True), 1), else_=0))
        total_count = func.count(FlashcardAttempt.id)
        stmt: Select[tuple[Flashcard, int, int, Optional[float], object]] = (
            select(
                Flashcard,
                total_count.label("attempt_count"),
                correct_count.label("correct_count"),
                (correct_count / func.nullif(total_count, 0)).label("success_rate"),
                func.max(FlashcardAttempt.created_at).label("last_attempted"),
            )
            .join(Flashcard.folder)
            .outerjoin(
                FlashcardAttempt,
                (FlashcardAttempt.flashcard_id == Flashcard.id)
                & (FlashcardAttempt.user_id == user_id),
            )
            .where(Flashcard.folder.has(user_id=user_id))
            .group_by(Flashcard.id)
            .order_by(Flashcard.created_at.desc())
        )
        rows = await self.session.execute(stmt)
        return list(rows.all())

    async def next_attempt_number(self, user_id: int, flashcard_id: int) -> int:
        current = await self.session.scalar(
            select(func.max(FlashcardAttempt.attempt_number)).where(
                FlashcardAttempt.user_id == user_id,
                FlashcardAttempt.flashcard_id == flashcard_id,
            )
        )
        return int(current or 0) + 1

    async def record_attempt(
        self, user_id: int, flashcard_id: int, correct: bool, time_ms: Optional[int]
    ) -> FlashcardAttempt:
        # Compute the next attempt number inside the INSERT as a scalar subquery
        # so recording an attempt is one DB round-trip, not SELECT MAX(...) then
        # INSERT. Nothing reads attempt_number back, so the post-flush expiry of
        # the SQL-expression column is harmless.
        next_number = (
            select(func.coalesce(func.max(FlashcardAttempt.attempt_number), 0) + 1)
            .where(
                FlashcardAttempt.user_id == user_id,
                FlashcardAttempt.flashcard_id == flashcard_id,
            )
            .scalar_subquery()
        )
        attempt = FlashcardAttempt(
            user_id=user_id,
            flashcard_id=flashcard_id,
            correct=correct,
            time_ms=time_ms,
            attempt_number=next_number,
        )
        self.session.add(attempt)
        await self.session.flush()
        return attempt

    async def success_rate(self, user_id: int, flashcard_id: int) -> tuple[int, int, float]:
        correct_count = await self.session.scalar(
            select(func.count(FlashcardAttempt.id)).where(
                FlashcardAttempt.user_id == user_id,
                FlashcardAttempt.flashcard_id == flashcard_id,
                FlashcardAttempt.correct.is_(True),
            )
        )
        total_count = await self.session.scalar(
            select(func.count(FlashcardAttempt.id)).where(
                FlashcardAttempt.user_id == user_id,
                FlashcardAttempt.flashcard_id == flashcard_id,
            )
        )
        total = int(total_count or 0)
        correct_total = int(correct_count or 0)
        return correct_total, total, (correct_total / total if total else 0.0)
