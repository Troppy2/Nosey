from datetime import datetime, timezone
from typing import Annotated

from pydantic import PlainSerializer


def utcnow_naive() -> datetime:
    """Current UTC time without tzinfo, matching the naive DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_utc_iso(value: datetime) -> str:
    # Naive DateTime columns hold UTC; mark it so browsers don't read it as local time.
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return aware.isoformat().replace("+00:00", "Z")


# A datetime that serializes to JSON as an ISO string ending in Z.
UtcDatetime = Annotated[datetime, PlainSerializer(_to_utc_iso, return_type=str, when_used="json")]
