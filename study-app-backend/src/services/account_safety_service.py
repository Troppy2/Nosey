"""Bans, re-sign-up tombstones and moderation of typed input (GH #172, #173).

Moderation policy (decided 2026-10-12, see GH #173):
- sexual/minors: request refused, account auto-banned (never an admin),
  permanent tombstone so deleting the account cannot undo the ban.
- harmful (weapons / violent wrongdoing, graphic violence, threats, sexual
  violence): request refused with a warning, flagged for admin review.
- self-harm: request ANSWERED as normal, flagged quietly, and the response
  carries a "self-harm" notice so the app shows support resources.
Runs BEFORE any AI call. With no OPENAI_API_KEY moderation is off entirely
(one warning at startup). With a key, a failed check (timeout, outage) lets
the request through and is logged as a "moderation" usage error, which the
admin stats already surface.

Flags, bans and usage logs are written in their own short session: a refused
request raises, which would roll back anything written in the route's session.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
from datetime import timedelta
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from src.config import settings
from src.database import async_session_maker
from src.models.account_safety import AccountTombstone, ContentFlag
from src.models.usage_event import UsageEvent
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.utils.exceptions import LLMException, ModerationQuotaExhausted, ModerationRateLimited
from src.utils.safety_notice import SAFETY_HEADER, set_safety_notice
from src.utils.time import utcnow_naive

logger = logging.getLogger(__name__)

SUSPENDED_MESSAGE = "This account has been suspended."
WARNING_MESSAGE = (
    "Kojo can't help with that. Requests like this break Nosey's rules, and repeating them "
    "can get your account banned."
)

# OpenAI omni-moderation category names. Plain "violence", "sexual", "hate" and
# "harassment" are left out on purpose: they fire on history, health and
# literature that students legitimately study. Sexual violence is caught as
# "sexual" and "violence" flagged together.
_MINORS = {"sexual/minors"}
_HARMFUL = {"illicit/violent", "violence/graphic", "harassment/threatening", "hate/threatening"}
_SELF_HARM = {"self-harm", "self-harm/intent", "self-harm/instructions"}

# Per-input size sent to the classifier, and inputs per moderation request.
# Everything typed is screened: a long input is sent in several requests
# rather than cut off, so harmless padding can't push content past the check.
_CHUNK_CHARS = 8000
_CHUNKS_PER_CALL = 16
_EXCERPT_CHARS = 2000


def subject_hash(google_id: str) -> str:
    """Keyed hash of a Google subject id. The raw id is never stored."""
    key = settings.tombstone_hmac_key or f"tombstone:{settings.jwt_secret}"
    return hmac.new(key.encode(), google_id.encode(), hashlib.sha256).hexdigest()


def _chunks(texts: Iterable[Optional[str]]) -> list[str]:
    """Join the texts, then cut into classifier-sized pieces.

    Joined first so thirty short test answers cost one input, not thirty.
    """
    joined = "\n\n".join(t.strip() for t in texts if t and t.strip())
    return [joined[i:i + _CHUNK_CHARS] for i in range(0, len(joined), _CHUNK_CHARS)]


def classify(result: dict) -> tuple[Optional[str], list[str], float]:
    """(severity or None, categories that fired, top score among them)."""
    categories = result.get("categories") or {}
    scores = result.get("category_scores") or {}
    fired = {name for name, hit in categories.items() if hit}
    if fired & _MINORS:
        severity, names = "minors", fired & _MINORS
    elif fired & _HARMFUL or {"sexual", "violence"} <= fired:
        severity = "harmful"
        names = (fired & _HARMFUL) or {"sexual", "violence"}
    elif fired & _SELF_HARM:
        severity, names = "self_harm", fired & _SELF_HARM
    else:
        return None, [], 0.0
    top = max((float(scores.get(name, 0.0)) for name in names), default=0.0)
    return severity, sorted(names), top


_SEVERITY_RANK = {"minors": 3, "harmful": 2, "self_harm": 1}

if not settings.openai_api_key:
    logger.warning("OPENAI_API_KEY is not set: content moderation is OFF (GH #173).")


async def screen_user_input(
    user: User, feature: str, *texts: Optional[str], block_harmful: bool = True, serialize: bool = False
) -> None:
    """Moderate text a user typed before it reaches any AI model.

    Raises HTTPException 403 (suspended) or 400 (warning) when the request must
    not go ahead; returns normally otherwise, after recording a self-harm
    notice on the response when one applies.

    block_harmful=False is for submissions that must not be lost (a whole test
    attempt): a "harmful" hit is still flagged and the warning still shown, but
    the request goes through. A minors hit is refused and banned regardless.

    serialize=True runs this account's checks one at a time (MCP writes, where
    a client fires many in parallel), so one account cannot burst the shared
    moderation rate limit.
    """
    if not settings.openai_api_key:
        # Moderation not configured: off, not failing. Warned once at import.
        return
    chunks = _chunks(texts)
    if not chunks:
        return
    try:
        if serialize:
            results = await _moderate_serialized(user.id, chunks)
        else:
            results = await _moderate(chunks)
    except ModerationQuotaExhausted as exc:
        # The key's quota is spent: an outage for every account, not something
        # this user provoked. Fail OPEN like an outage (refusing would block all
        # of Nosey), and log loudly so it is fixed in the OpenAI dashboard.
        await _log_moderation_failure(user.id, _QUOTA_EXHAUSTED)
        logger.error("Moderation quota exhausted, failing open for %s: %s", feature, exc)
        return
    except ModerationRateLimited as exc:
        # Fail CLOSED: failing open here would let a flood skip the check.
        # Not counted toward the forced-failure heuristic (a burst is not an attack).
        await _log_moderation_failure(user.id, _RATE_LIMITED)
        logger.warning("Moderation rate limited for %s; refusing user=%s", feature, user.id)
        raise HTTPException(status_code=503, detail=_RATE_LIMITED_MESSAGE) from exc
    except LLMException as exc:
        await _log_moderation_failure(user.id, type(exc.__cause__ or exc).__name__)
        if len(chunks) > _CHUNKS_PER_CALL or await _failures_look_forced(user.id):
            # Fail CLOSED when the failure could have been provoked: a very long
            # input (several calls, the easiest to time out) or one account
            # failing repeatedly while others are fine. Real outages hit many
            # accounts at once and still fail open below.
            logger.warning("Moderation failed for %s and looks forced; refusing user=%s", feature, user.id)
            raise HTTPException(
                status_code=503,
                detail="Nosey couldn't run its safety check just now. Please try again in a moment.",
            ) from exc
        logger.warning("Moderation unavailable, failing open for %s: %s", feature, exc)
        return

    worst: Optional[tuple[str, list[str], float, str]] = None
    for chunk, result in zip(chunks, results):
        severity, names, score = classify(result)
        if severity and (worst is None or _SEVERITY_RANK[severity] > _SEVERITY_RANK[worst[0]]):
            worst = (severity, names, score, chunk)
    if worst is None:
        return

    severity, names, score, excerpt = worst
    async with async_session_maker() as session:
        flag = ContentFlag(
            user_id=user.id,
            # Lets the flag outlive account deletion and relink on re-sign-up.
            subject_hash=None if user.google_id.startswith("guest_") else subject_hash(user.google_id),
            feature=feature[:40],
            severity=severity,
            categories=",".join(names)[:255],
            score=score,
            excerpt=excerpt[:_EXCERPT_CHARS],
        )
        session.add(flag)
        if severity == "minors" and not user.is_admin:
            fresh = await session.get(User, user.id)
            if fresh is not None:
                await ban_user(session, fresh, reason=f"Automatic: {', '.join(names)} in {feature}", banned_by=None)
            flag.action = "auto_banned"
            flag.reviewed_at = utcnow_naive()
        await session.commit()

    logger.warning(
        "Moderation hit: user=%s feature=%s severity=%s categories=%s", user.id, feature, severity, names
    )
    if severity == "minors" and not user.is_admin:
        raise HTTPException(status_code=403, detail=SUSPENDED_MESSAGE, headers={SAFETY_HEADER: "suspended"})
    if severity == "minors" or (severity == "harmful" and block_harmful):
        raise HTTPException(status_code=400, detail=WARNING_MESSAGE, headers={SAFETY_HEADER: "warning"})
    # "warning-allowed": the submission went through but broke the rules, so
    # the app must not say it was blocked.
    set_safety_notice("warning-allowed" if severity == "harmful" else "self-harm")


_RATE_LIMITED = "RateLimited"
_QUOTA_EXHAUSTED = "QuotaExhausted"
_RATE_LIMITED_MESSAGE = "Too many changes at once. Please wait a few seconds and try again."
# Namespace for pg_advisory_xact_lock(int, int), distinct from quota_service's.
_MODERATION_LOCK_NAMESPACE = 5603
# Longest one serialized check waits for the account's earlier ones, and how
# often it retries the lock while waiting (no DB connection held in between).
_MODERATION_LOCK_WAIT_S = 15.0
_MODERATION_LOCK_POLL_S = 0.5


async def _moderate(chunks: list[str]) -> list[dict]:
    from src.services.llm_service import LLMService

    llm = LLMService()
    results: list[dict] = []
    for start in range(0, len(chunks), _CHUNKS_PER_CALL):
        results.extend(await llm.moderate(chunks[start:start + _CHUNKS_PER_CALL]))
    return results


async def _moderate_serialized(user_id: int, chunks: list[str]) -> list[dict]:
    """_moderate under a per-account Postgres advisory lock so it works across
    workers. The lock is only TRIED: a busy account's waiters give their pooled
    connection back between attempts, so a burst holds one connection per
    account, never one per request. No lock on SQLite."""
    deadline = asyncio.get_running_loop().time() + _MODERATION_LOCK_WAIT_S
    while True:
        async with async_session_maker() as session:
            if session.bind is None or session.bind.dialect.name != "postgresql":
                return await _moderate(chunks)
            got = await session.scalar(
                text("SELECT pg_try_advisory_xact_lock(:ns, :key)"),
                {"ns": _MODERATION_LOCK_NAMESPACE, "key": int(user_id) % 2_147_483_647},
            )
            if got:
                try:
                    return await _moderate(chunks)
                finally:
                    await session.rollback()  # releases the lock
        if asyncio.get_running_loop().time() >= deadline:
            logger.warning("Moderation queue wait timed out for user=%s", user_id)
            raise HTTPException(status_code=503, detail=_RATE_LIMITED_MESSAGE)
        await asyncio.sleep(_MODERATION_LOCK_POLL_S)


# Forced-failure heuristic: this many failures for one account inside the
# window, while fewer than _OUTAGE_ACCOUNTS accounts are failing overall.
_FORCED_WINDOW = timedelta(minutes=10)
_FORCED_USER_FAILURES = 3
_OUTAGE_ACCOUNTS = 5


async def _failures_look_forced(user_id: int) -> bool:
    try:
        since = utcnow_naive() - _FORCED_WINDOW
        async with async_session_maker() as session:
            recent = (
                UsageEvent.feature == "moderation",
                UsageEvent.success.is_(False),
                UsageEvent.created_at >= since,
                or_(
                    UsageEvent.error_type.is_(None),
                    UsageEvent.error_type.not_in((_RATE_LIMITED, _QUOTA_EXHAUSTED)),
                ),
            )
            mine = await session.scalar(
                select(func.count()).select_from(UsageEvent).where(*recent, UsageEvent.user_id == user_id)
            )
            accounts = await session.scalar(
                select(func.count(func.distinct(UsageEvent.user_id))).where(*recent)
            )
        return int(mine or 0) >= _FORCED_USER_FAILURES and int(accounts or 0) < _OUTAGE_ACCOUNTS
    except Exception:
        logger.exception("Could not evaluate moderation failures; treating as an outage")
        return False


async def relink_flags(session: AsyncSession, user: User) -> int:
    """Attach flags left by a deleted account to the same Google account's new row."""
    if user.google_id.startswith("guest_"):
        return 0
    result = await session.execute(
        update(ContentFlag)
        .where(ContentFlag.user_id.is_(None), ContentFlag.subject_hash == subject_hash(user.google_id))
        .values(user_id=user.id)
    )
    return result.rowcount or 0


async def detach_flags(session: AsyncSession, user_id: int) -> None:
    """Keep a deleting account's flags (the FK does this on Postgres; explicit
    here so it never depends on the database enforcing ON DELETE SET NULL)."""
    await session.execute(update(ContentFlag).where(ContentFlag.user_id == user_id).values(user_id=None))


async def _log_moderation_failure(user_id: int, error_type: str) -> None:
    try:
        async with async_session_maker() as session:
            await UsageEventRepository(session).log_event(
                user_id, "moderation", 0, success=False, error_type=error_type[:50]
            )
            await session.commit()
    except Exception:
        logger.exception("Could not log a moderation failure")


# ── Bans ─────────────────────────────────────────────────────────────────────


async def ban_user(session: AsyncSession, user: User, reason: str, banned_by: Optional[int]) -> None:
    """Ban in the caller's session (caller commits). Admins are never banned."""
    if user.is_admin:
        raise ValueError("Admins cannot be banned.")
    user.banned_at = utcnow_naive()
    user.ban_reason = reason[:500]
    user.banned_by = banned_by
    if not user.google_id.startswith("guest_"):
        session.add(AccountTombstone(subject_hash=subject_hash(user.google_id), reason="banned", expires_at=None))


async def unban_user(session: AsyncSession, user: User) -> None:
    user.banned_at = None
    user.ban_reason = None
    user.banned_by = None
    await session.execute(
        delete(AccountTombstone).where(
            AccountTombstone.subject_hash == subject_hash(user.google_id),
            AccountTombstone.reason == "banned",
        )
    )


async def is_device_banned(session: AsyncSession, device_id: Optional[str]) -> bool:
    if not device_id:
        return False
    found = await session.scalar(
        select(User.id).where(User.last_device_id == device_id, User.banned_at.is_not(None)).limit(1)
    )
    return found is not None


async def remember_device(user: User, device_id: Optional[str]) -> None:
    """Record the user's current device id when it changed (rare write)."""
    if not device_id or user.last_device_id == device_id:
        return
    # Mark the loaded user current WITHOUT dirtying it: a dirty attribute
    # would make the route session issue its own UPDATE and hold the users
    # row lock for the whole request (a Kojo stream included).
    set_committed_value(user, "last_device_id", device_id)
    try:
        async with async_session_maker() as session:
            await session.execute(update(User).where(User.id == user.id).values(last_device_id=device_id))
            await session.commit()
    except Exception:
        logger.warning("Could not record device id for user %s", user.id)


# ── Re-sign-up tombstones (GH #172) ──────────────────────────────────────────


def add_deletion_tombstone(session: AsyncSession, google_id: str) -> None:
    """Block the same Google account from signing up again for the cooldown."""
    if google_id.startswith("guest_"):
        return
    session.add(
        AccountTombstone(
            subject_hash=subject_hash(google_id),
            reason="deleted",
            expires_at=utcnow_naive() + timedelta(hours=settings.account_recreate_cooldown_hours),
        )
    )


async def active_tombstone(session: AsyncSession, google_id: str) -> Optional[AccountTombstone]:
    """The tombstone blocking this Google account from signing up, if any.

    A ban beats a cooldown; among cooldowns the one ending last wins.
    """
    now = utcnow_naive()
    rows = (
        await session.scalars(
            select(AccountTombstone).where(
                AccountTombstone.subject_hash == subject_hash(google_id),
                (AccountTombstone.expires_at.is_(None)) | (AccountTombstone.expires_at > now),
            )
        )
    ).all()
    if not rows:
        return None
    banned = [row for row in rows if row.reason == "banned"]
    if banned:
        return banned[0]
    return max(rows, key=lambda row: row.expires_at or now)


async def purge_expired_safety_rows(session: AsyncSession) -> tuple[int, int]:
    """Delete expired tombstones and flags past retention not tied to a ban."""
    now = utcnow_naive()
    tombstones = await session.execute(
        delete(AccountTombstone).where(
            AccountTombstone.expires_at.is_not(None), AccountTombstone.expires_at <= now
        )
    )
    cutoff = now - timedelta(days=settings.content_flag_retention_days)
    banned_users = select(User.id).where(User.banned_at.is_not(None))
    flags = await session.execute(
        delete(ContentFlag).where(
            ContentFlag.created_at < cutoff,
            # Explicit NULL branch: "NULL NOT IN (...)" is NULL, so flags of
            # deleted accounts would otherwise never be purged.
            ContentFlag.user_id.is_(None) | ContentFlag.user_id.not_in(banned_users),
        )
    )
    return tombstones.rowcount or 0, flags.rowcount or 0
