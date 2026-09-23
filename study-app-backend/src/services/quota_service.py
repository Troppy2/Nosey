"""Per-user and per-device rolling-window usage limits for the core LLM features.

- Tests: count of generations (create + regenerate), refundable on total failure.
- Flashcards: count of cards; a request larger than what is left is clamped.
- Kojo: real provider tokens (input + output) from llm_token_usage, plus a cap
  on concurrent requests (utils/kojo_inflight.py).

Limited: every account except admins and beta users, INCLUDING guests.

Every limit is enforced twice, per account and per device, and whichever runs
out first blocks. The device is the browser-generated X-Device-Id (see
dependencies.get_current_user), so several accounts on one device (a second
Google account, or a fresh guest account after signing out) share one budget.
The device id is best-effort: clearing storage defeats it. It exists to stop
casual multi-account and guest-account farming, not a determined attacker.

settings.usage_limits_enabled=false turns every check off (token tracking keeps
running).

Stateless: every method takes the session, per this codebase's service rules.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.llm_token_usage import LLMTokenUsage
from src.models.quota_charge import QuotaCharge
from src.models.user import User
from src.utils import kojo_inflight
from src.utils.time import utcnow_naive
from src.utils.usage_context import current_device_id

FEATURE_TESTS = "test"
FEATURE_FLASHCARDS = "flashcard"
FEATURE_KOJO = "kojo"

# Every Kojo usage-scope feature name starts with this prefix
# (kojo_chat, kojo_general, kojo_regenerate, kojo_action).
KOJO_FEATURE_PREFIX = "kojo_"

# Namespace for pg_advisory_xact_lock(int, int) so these locks cannot collide
# with any other advisory lock the app might take later.
_LOCK_NAMESPACE = 5601
_DEVICE_LOCK_NAMESPACE = 5602

DEVICE_HEADER = "X-Device-Id"


class QuotaExceeded(HTTPException):
    """HTTP 429 with a readable `detail`. An HTTPException so it passes through
    route-level `except Exception` wrappers that re-raise HTTPException intact
    and keeps CORS headers (rules-gotchas: CORS headers missing on 500s)."""

    def __init__(self, message: str) -> None:
        super().__init__(status_code=429, detail=message)


class DeviceIdRequired(HTTPException):
    """A limited request arrived without a device id.

    SECURITY: without this, stripping the header would silently skip the
    per-device limits. The real frontend always sends it, so this only fires
    for stale tabs (from before the header existed) and hand-crafted requests.
    """

    def __init__(self) -> None:
        super().__init__(
            status_code=428,
            detail="Please refresh the page and try again.",
        )


@dataclass
class FeatureStatus:
    feature: str
    used: int
    limit: int
    unit: str
    resets_at: Optional[datetime]


def is_guest(user: User) -> bool:
    # Same rule as UserResponse.is_guest (schemas/auth_schema.py).
    return bool(user.email and user.email.endswith("@nosey.guest"))


def is_exempt(user: User) -> bool:
    """Admins and beta users have no limits. Guests ARE limited."""
    return bool(getattr(user, "is_admin", False) or getattr(user, "is_beta", False))


def normalize_device_id(raw: Optional[str]) -> Optional[str]:
    """Canonical lowercase UUID, or None when the header is missing or malformed.

    Strict parsing keeps arbitrary client text out of the DB and makes two
    spellings of one id impossible."""
    if not raw:
        return None
    try:
        return str(uuid.UUID(raw.strip()))
    except (ValueError, AttributeError):
        return None


def _window() -> timedelta:
    return timedelta(hours=settings.usage_window_hours)


def _format_wait(until: Optional[datetime]) -> str:
    if until is None:
        return "soon"
    seconds = max(60, int((until - utcnow_naive()).total_seconds()))
    hours, rem = divmod(seconds, 3600)
    minutes = rem // 60
    if hours and minutes:
        return f"in {hours}h {minutes}m"
    if hours:
        return f"in {hours}h"
    return f"in {minutes}m"


def _worst(account: tuple[int, Optional[datetime]], device: tuple[int, Optional[datetime]]) -> tuple[int, Optional[datetime]]:
    """The binding bucket: the higher usage, and when that bucket frees up."""
    return device if device[0] > account[0] else account


class KojoSlot:
    """An acquired Kojo in-flight slot. release() is idempotent."""

    def __init__(self, keys: list[str]) -> None:
        self._keys = keys

    def release(self) -> None:
        if self._keys:
            kojo_inflight.release(self._keys)
            self._keys = []


class QuotaService:
    def limits_active(self, user: User) -> bool:
        return settings.usage_limits_enabled and not is_exempt(user)

    def _device_for(self, user: User) -> str:
        """The request's device id. Raises 428 for a limited user without one."""
        device_id = current_device_id()
        if device_id is None:
            raise DeviceIdRequired()
        return device_id

    async def _lock(self, session: AsyncSession, user_id: int, device_id: Optional[str]) -> None:
        """Serialize check-and-charge per account AND per device so two parallel
        requests (even from two accounts on one device) cannot both pass at
        limit-1. Locks are always taken in the same order (account, then
        device) so they cannot deadlock. Released on commit. No-op on SQLite."""
        if session.bind is None or session.bind.dialect.name != "postgresql":
            return
        await session.execute(
            text("SELECT pg_advisory_xact_lock(:ns, :key)"),
            {"ns": _LOCK_NAMESPACE, "key": int(user_id) % 2_147_483_647},
        )
        if device_id:
            await session.execute(
                text("SELECT pg_advisory_xact_lock(:ns, hashtext(:device))"),
                {"ns": _DEVICE_LOCK_NAMESPACE, "device": device_id},
            )

    async def _charge_usage(
        self, session: AsyncSession, feature: str, *, user_id: Optional[int] = None, device_id: Optional[str] = None
    ) -> tuple[int, Optional[datetime]]:
        if user_id is None and device_id is None:
            return 0, None
        cutoff = utcnow_naive() - _window()
        owner = QuotaCharge.user_id == user_id if user_id is not None else QuotaCharge.device_id == device_id
        row = (await session.execute(
            select(func.coalesce(func.sum(QuotaCharge.units), 0), func.min(QuotaCharge.created_at)).where(
                owner,
                QuotaCharge.feature == feature,
                QuotaCharge.refunded.is_(False),
                QuotaCharge.units > 0,
                QuotaCharge.created_at >= cutoff,
            )
        )).one()
        oldest = row[1]
        return int(row[0] or 0), (oldest + _window()) if oldest else None

    async def _kojo_usage(
        self, session: AsyncSession, *, user_id: Optional[int] = None, device_id: Optional[str] = None
    ) -> tuple[int, Optional[datetime]]:
        if user_id is None and device_id is None:
            return 0, None
        cutoff = utcnow_naive() - _window()
        owner = LLMTokenUsage.user_id == user_id if user_id is not None else LLMTokenUsage.device_id == device_id
        row = (await session.execute(
            select(
                func.coalesce(func.sum(LLMTokenUsage.input_tokens + LLMTokenUsage.output_tokens), 0),
                func.min(LLMTokenUsage.created_at),
            ).where(
                owner,
                LLMTokenUsage.feature.like(f"{KOJO_FEATURE_PREFIX}%"),
                LLMTokenUsage.created_at >= cutoff,
            )
        )).one()
        oldest = row[1]
        return int(row[0] or 0), (oldest + _window()) if oldest else None

    async def _charge_usage_both(self, session: AsyncSession, feature: str, user_id: int, device_id: Optional[str]):
        account = await self._charge_usage(session, feature, user_id=user_id)
        device = await self._charge_usage(session, feature, device_id=device_id)
        return _worst(account, device)

    async def get_status(self, session: AsyncSession, user: User) -> list[FeatureStatus]:
        """Usage as the limits see it: the binding bucket (account or device)
        for limited users, the account alone for exempt ones."""
        device_id = current_device_id() if self.limits_active(user) else None
        tests = await self._charge_usage_both(session, FEATURE_TESTS, user.id, device_id)
        cards = await self._charge_usage_both(session, FEATURE_FLASHCARDS, user.id, device_id)
        kojo = _worst(
            await self._kojo_usage(session, user_id=user.id),
            await self._kojo_usage(session, device_id=device_id),
        )
        return [
            FeatureStatus(FEATURE_TESTS, tests[0], settings.test_limit_per_window, "tests", tests[1]),
            FeatureStatus(FEATURE_FLASHCARDS, cards[0], settings.flashcard_limit_per_window, "cards", cards[1]),
            FeatureStatus(FEATURE_KOJO, kojo[0], settings.kojo_token_limit_per_window, "tokens", kojo[1]),
        ]

    async def charge_test(self, session: AsyncSession, user: User, ref_id: Optional[int] = None) -> Optional[int]:
        """Charge one test generation and commit. Returns the charge id, or None
        when the user is not limited. Raises QuotaExceeded at the cap."""
        if not self.limits_active(user):
            return None
        device_id = self._device_for(user)
        await self._lock(session, user.id, device_id)
        used, resets_at = await self._charge_usage_both(session, FEATURE_TESTS, user.id, device_id)
        limit = settings.test_limit_per_window
        if used >= limit:
            await session.commit()  # releases the advisory locks; nothing pending
            raise QuotaExceeded(
                f"You've used {min(used, limit)} of {limit} test generations in the last "
                f"{settings.usage_window_hours} hours. Next one frees up {_format_wait(resets_at)}."
            )
        charge = QuotaCharge(user_id=user.id, device_id=device_id, feature=FEATURE_TESTS, units=1, ref_id=ref_id)
        session.add(charge)
        await session.commit()
        return charge.id

    async def charge_flashcards(self, session: AsyncSession, user: User, requested: int) -> tuple[int, Optional[int]]:
        """Charge up to `requested` cards and commit.

        Returns (allowed_count, charge_id). allowed_count is clamped to what is
        left in the tighter of the account and device buckets. Raises
        QuotaExceeded only when nothing is left.
        """
        if not self.limits_active(user):
            return requested, None
        device_id = self._device_for(user)
        await self._lock(session, user.id, device_id)
        used, resets_at = await self._charge_usage_both(session, FEATURE_FLASHCARDS, user.id, device_id)
        limit = settings.flashcard_limit_per_window
        remaining = limit - used
        if remaining <= 0:
            await session.commit()  # releases the advisory locks; nothing pending
            raise QuotaExceeded(
                f"You've generated {min(used, limit)} of {limit} flashcards in the last "
                f"{settings.usage_window_hours} hours. More free up {_format_wait(resets_at)}."
            )
        allowed = min(requested, remaining)
        charge = QuotaCharge(user_id=user.id, device_id=device_id, feature=FEATURE_FLASHCARDS, units=allowed)
        session.add(charge)
        await session.commit()
        return allowed, charge.id

    async def settle_charge(self, session: AsyncSession, charge_id: Optional[int], units: int) -> None:
        """Adjust a charge DOWN to what was actually produced. 0 refunds it.

        Never raises a charge: units is capped at the original amount, so a
        caller bug cannot inflate anyone's usage. Commits.
        """
        if charge_id is None:
            return
        charge = await session.get(QuotaCharge, charge_id)
        if charge is None:
            return
        if units <= 0:
            charge.refunded = True
        else:
            charge.units = min(charge.units, units)
        await session.commit()

    async def refund(self, session: AsyncSession, charge_id: Optional[int]) -> None:
        await self.settle_charge(session, charge_id, 0)

    async def acquire_kojo(self, session: AsyncSession, user: User) -> KojoSlot:
        """Gate one Kojo request. Returns a slot the caller MUST release when the
        answer finishes (in a finally; for streams, in the generator's finally).

        1. Take an in-flight slot on the account and the device (at most
           kojo_inflight.MAX_INFLIGHT concurrent requests each), so a burst of
           parallel requests cannot all pass the budget check below before any
           of their tokens are recorded.
        2. Check the token budget, per account and per device.

        The budget is checked before a message only: an answer in flight always
        finishes, so usage can overshoot by at most MAX_INFLIGHT messages.
        """
        if not self.limits_active(user):
            return KojoSlot([])
        device_id = self._device_for(user)
        keys = [f"u:{user.id}", f"d:{device_id}"]
        if not kojo_inflight.try_acquire(keys):
            raise QuotaExceeded("Kojo is still answering your other messages. Wait for them to finish, then try again.")
        slot = KojoSlot(keys)
        try:
            used, resets_at = _worst(
                await self._kojo_usage(session, user_id=user.id),
                await self._kojo_usage(session, device_id=device_id),
            )
            if used >= settings.kojo_token_limit_per_window:
                raise QuotaExceeded(
                    f"You've reached your Kojo usage limit for the last {settings.usage_window_hours} hours. "
                    f"Kojo frees up {_format_wait(resets_at)}."
                )
        except BaseException:
            slot.release()
            raise
        return slot
