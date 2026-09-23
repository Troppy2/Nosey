from datetime import datetime, timezone


def utcnow_naive() -> datetime:
    """Current UTC time without tzinfo, matching the naive DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
