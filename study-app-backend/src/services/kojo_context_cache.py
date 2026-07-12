"""In-process cache for the assembled Kojo folder context (GH #53).

Kojo chat and the test-blueprint flow both need the folder's study context
(practice-test note snapshots + live folder files) on every request, but that
content rarely changes between messages in a conversation. This module builds
it once per folder and reuses it until the underlying notes or files change.

This is deliberate module-level state, not service state: services stay
stateless and per-request, while the cache must outlive requests. The deploy
runs a single uvicorn worker (see rules-gotchas 8a), so an in-process dict is
safe. If the backend ever moves to multiple workers or instances, this must
move to a shared store (e.g. Redis) or each worker will hold its own copy and
invalidation will only reach the worker that handled the mutation.

Consistency: mutation points call invalidate_folder(), which bumps a per-folder
generation counter. A build only stores its result if no invalidation happened
while it was reading the DB, so a slow build cannot clobber a fresh
invalidation with stale content. The TTL is a safety net for any missed
invalidation hook, not the primary freshness mechanism.
"""
from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.utils.logger import get_logger

logger = get_logger(__name__)

_TTL_SECONDS = 15 * 60
_MAX_ENTRIES = 32
# Contexts above this size are rebuilt per request instead of pinned in memory.
_MAX_ENTRY_CHARS = 5_000_000

# (user_id, folder_id) -> (stored_at_monotonic, generation_at_build, context)
_cache: OrderedDict[tuple[int, int], tuple[float, int, str]] = OrderedDict()
# folder_id -> invalidation counter. Grows by one int per mutated folder.
_generation: dict[int, int] = {}
# Strong references so warm tasks are not garbage-collected mid-run.
_warm_tasks: set[asyncio.Task] = set()


def _current_generation(folder_id: int) -> int:
    return _generation.get(folder_id, 0)


def _get_cached(user_id: int, folder_id: int) -> Optional[str]:
    key = (user_id, folder_id)
    entry = _cache.get(key)
    if entry is None:
        return None
    stored_at, gen, value = entry
    if time.monotonic() - stored_at > _TTL_SECONDS or gen != _current_generation(folder_id):
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return value


def _store(user_id: int, folder_id: int, generation: int, value: str) -> None:
    if generation != _current_generation(folder_id):
        # Folder content changed while this context was being built.
        return
    if len(value) > _MAX_ENTRY_CHARS:
        return
    _cache[(user_id, folder_id)] = (time.monotonic(), generation, value)
    _cache.move_to_end((user_id, folder_id))
    while len(_cache) > _MAX_ENTRIES:
        _cache.popitem(last=False)


def invalidate_folder(folder_id: int) -> None:
    """Drop cached context for a folder after its notes or files change."""
    _generation[folder_id] = _current_generation(folder_id) + 1
    stale = [key for key in _cache if key[1] == folder_id]
    for key in stale:
        _cache.pop(key, None)


async def _build(folder_id: int, user_id: int, session: AsyncSession) -> str:
    # Imported here, not at module top, so this cache module stays importable
    # from repositories/routes without dragging the service layer with it.
    from src.repositories.kojo_repository import KojoRepository
    from src.services.file_service import FileService

    notes = await KojoRepository(session).get_folder_notes_content(folder_id, user_id)
    folder_files = await FileService().get_folder_files_content(folder_id, user_id, session)
    parts = [part for part in (notes, folder_files) if part]
    return "\n\n---\n\n".join(parts)


async def get_folder_context(
    folder_id: int, user_id: int, session: AsyncSession
) -> tuple[str, bool]:
    """Return (assembled folder-level context, cache_hit).

    The context is the folder's test-note snapshots plus live folder files,
    joined with the same separator chat() uses, so callers can append
    conversation-scoped parts (session uploads) without a format change.
    Returns an empty string when the folder has no study content.
    """
    cached = _get_cached(user_id, folder_id)
    if cached is not None:
        return cached, True
    generation = _current_generation(folder_id)
    context = await _build(folder_id, user_id, session)
    _store(user_id, folder_id, generation, context)
    return context, False


def schedule_warm(folder_id: int, user_id: int) -> None:
    """Warm the cache off the request cycle so the first chat message skips the build.

    Detached via asyncio.create_task (NOT FastAPI BackgroundTasks, see
    rules-gotchas 8a) with its own DB session, mirroring _spawn_generation in
    routes/tests.py. No-op when a fresh entry already exists.
    """
    if _get_cached(user_id, folder_id) is not None:
        return
    task = asyncio.create_task(_warm(folder_id, user_id))
    _warm_tasks.add(task)
    task.add_done_callback(_warm_tasks.discard)


async def _warm(folder_id: int, user_id: int) -> None:
    from src.database import async_session_maker

    try:
        generation = _current_generation(folder_id)
        async with async_session_maker() as session:
            context = await _build(folder_id, user_id, session)
        _store(user_id, folder_id, generation, context)
        logger.info(
            "Kojo folder context warmed",
            extra={"folder_id": folder_id, "user_id": user_id, "context_length": len(context)},
        )
    except Exception as exc:
        # Warming is best-effort; the chat request builds on demand if this fails.
        logger.warning("Kojo context warm failed for folder_id=%s: %s", folder_id, exc)
