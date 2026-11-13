"""Idle TTS audio expiry: stored audio lives only while people keep playing it.

Narration clips, KojoCode walkthrough audio and lecture audio are caches of TTS
output. Each row's `last_used_at` is bumped when it is served; the periodic
sweep (`upload_recovery.run_periodic_sweep`) deletes rows idle longer than
`AUDIO_CACHE_TTL_HOURS`. The next play regenerates the audio, which costs a TTS
call again: a deliberate trade of compute for Postgres storage (2026-11-12).

Module-level functions, no state: CLAUDE.md bans shared mutable state on services.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import delete, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.lc_sync import LCLectureAudio, LCWalkthroughAudio
from src.models.narration_clip import NarrationClip
from src.utils.logger import get_logger
from src.utils.time import utcnow_naive

logger = get_logger(__name__)

AUDIO_MODELS = (NarrationClip, LCWalkthroughAudio, LCLectureAudio)

# A clip is only re-stamped when its stamp is older than this, so a lesson
# playing dozens of clips does not write a row on every request. Far below
# any sensible TTL, so a row in use never looks idle.
TOUCH_EVERY = timedelta(minutes=15)


def audio_ttl() -> timedelta:
    return timedelta(hours=settings.audio_cache_ttl_hours)


async def touch(session: AsyncSession, row, now: Optional[datetime] = None) -> None:
    """Mark a stored audio row as just played. Never raises: a failed stamp must
    not stop playback (worst case the row expires one TTL early and is remade)."""
    now = now or utcnow_naive()
    last = getattr(row, "last_used_at", None)
    if last is not None and now - last < TOUCH_EVERY:
        return
    model = type(row)
    try:
        await session.execute(
            update(model)
            .where(model.id == row.id)
            .values(last_used_at=now)
            .execution_options(synchronize_session=False)
        )
        await session.commit()
        row.last_used_at = now
    except SQLAlchemyError:
        await session.rollback()
        logger.warning("audio last_used_at stamp failed for %s %s", model.__tablename__, row.id, exc_info=True)


async def purge_idle_audio(session: AsyncSession, now: Optional[datetime] = None) -> dict[str, int]:
    """Delete every stored audio row not played within the TTL. Returns rows
    deleted per table. last_used_at is the DB's now() in a column without a time
    zone (UTC on Neon), so the cutoff is naive UTC."""
    cutoff = (now or utcnow_naive()) - audio_ttl()
    deleted: dict[str, int] = {}
    for model in AUDIO_MODELS:
        result = await session.execute(
            delete(model).where(model.last_used_at < cutoff).execution_options(synchronize_session=False)
        )
        deleted[model.__tablename__] = result.rowcount or 0
    await session.commit()
    return deleted
