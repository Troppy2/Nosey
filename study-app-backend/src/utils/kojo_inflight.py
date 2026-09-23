"""Cap on concurrent Kojo requests per usage-limited user and per device.

SECURITY: the Kojo token budget is checked before a message, and a message's
tokens are only recorded once its provider call finishes. Without this cap a
user could fire many requests at once; every one would see the same pre-burst
total, pass the check, and together spend several times the budget. Capping
in-flight requests bounds the overshoot to MAX_INFLIGHT messages. Keys cover
both the account and the device, so several accounts on one device share the
same slots.

State is process-local, which is correct for the current deploy (a single
uvicorn worker, see rules-gotchas 8a). Moving to several workers requires a
shared store (e.g. a DB reservation row under pg_advisory_xact_lock).

Slots expire after SLOT_TTL_SECONDS so a streaming response whose body never
started (client gone before the first byte, so its finally never ran) cannot
lock a user out permanently.
"""
from __future__ import annotations

import time
from typing import Iterable

MAX_INFLIGHT = 2
SLOT_TTL_SECONDS = 300

# key -> slot start times (monotonic seconds). Keys look like "u:12" / "d:<uuid>".
_slots: dict[str, list[float]] = {}


def _live(key: str, now: float) -> list[float]:
    live = [started for started in _slots.get(key, []) if now - started < SLOT_TTL_SECONDS]
    if live:
        _slots[key] = live
    else:
        _slots.pop(key, None)
    return live


def try_acquire(keys: Iterable[str]) -> bool:
    """Take one slot on every key, or none at all.

    Synchronous on purpose: with no await between the check and the append, two
    coroutines on the event loop can never both take the last slot.
    """
    keys = [key for key in keys if key]
    now = time.monotonic()
    if any(len(_live(key, now)) >= MAX_INFLIGHT for key in keys):
        return False
    for key in keys:
        _slots.setdefault(key, []).append(now)
    return True


def release(keys: Iterable[str]) -> None:
    """Free one slot on each key. Safe to call more than once per key."""
    for key in keys:
        live = _slots.get(key)
        if not live:
            continue
        live.pop(0)
        if not live:
            _slots.pop(key, None)


def reset() -> None:
    """Clear all slots. Tests only."""
    _slots.clear()
