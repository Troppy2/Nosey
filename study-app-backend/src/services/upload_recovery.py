"""Recover folder uploads whose background parse died with the process (GH #107).

Parses run inside the one web process (Render's free tier has no background
workers), so a restart or crash loses them, and their rows would say
"processing" forever. Two passes fix that:

- at startup, every "processing" row is dead (no parse survives a restart);
- every SWEEP_INTERVAL_S, rows still "processing" STUCK_UPLOAD_THRESHOLD after
  upload are failed too (a deploy-overlap orphan, or a parse that hung).

A parse that does finish later still writes its real result over the error.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import async_session_maker
from src.models.folder_file import FolderFile
from src.utils.logger import get_logger
from src.utils.temp_uploads import cleanup_stale_temp_uploads

logger = get_logger(__name__)

INTERRUPTED_UPLOAD_MESSAGE = "Upload interrupted. Please try again."

# A 300-page parse (up to 15 min) plus two more queued ahead of it.
STUCK_UPLOAD_THRESHOLD = timedelta(minutes=45)
SWEEP_INTERVAL_S = 5 * 60
# Temp uploads older than this are orphans: every row using one is swept long before.
STALE_TEMP_UPLOAD_S = 2 * 60 * 60
# Startup must bind the port promptly (Render's port scan), even if the DB is slow.
BOOT_RECOVERY_TIMEOUT_S = 10.0


async def sweep_stuck_uploads(session: AsyncSession, older_than: Optional[timedelta] = None) -> int:
    """Fail "processing" rows (only those uploaded more than older_than ago, if given).

    Returns how many rows were failed. uploaded_at is the DB's now() in a column
    without a time zone, which is UTC on Neon, so the cutoff is naive UTC.
    """
    stmt = update(FolderFile).where(FolderFile.upload_status == "processing")
    if older_than is not None:
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - older_than
        stmt = stmt.where(FolderFile.uploaded_at < cutoff)
    result = await session.execute(
        stmt.values(upload_status="error", upload_error=INTERRUPTED_UPLOAD_MESSAGE).execution_options(
            synchronize_session=False
        )
    )
    await session.commit()
    return result.rowcount or 0


async def _recover_at_boot() -> None:
    async with async_session_maker() as session:
        failed = await sweep_stuck_uploads(session)
    removed = cleanup_stale_temp_uploads()
    if failed or removed:
        logger.warning(
            "Upload recovery at startup: %d interrupted uploads failed, %d temp files removed",
            failed,
            removed,
        )


async def recover_interrupted_uploads() -> None:
    """Startup pass. Never blocks startup for long and never raises."""
    try:
        await asyncio.wait_for(_recover_at_boot(), timeout=BOOT_RECOVERY_TIMEOUT_S)
    except Exception as exc:
        logger.warning("Upload recovery at startup failed; the periodic sweep will retry: %r", exc)


async def run_periodic_sweep(
    interval_s: float = SWEEP_INTERVAL_S,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Fail uploads stuck past the threshold, forever, until cancelled."""
    while True:
        await sleep(interval_s)
        try:
            async with async_session_maker() as session:
                failed = await sweep_stuck_uploads(session, older_than=STUCK_UPLOAD_THRESHOLD)
            cleanup_stale_temp_uploads(older_than_s=STALE_TEMP_UPLOAD_S)
            if failed:
                logger.warning("Upload sweep: %d uploads stuck in processing were failed", failed)
        except Exception as exc:
            logger.warning("Upload sweep failed: %r", exc)
