"""How much memory this process is using, from Linux's /proc (no extra dependency)."""
from __future__ import annotations

from typing import Optional


def process_rss_mb(status_path: str = "/proc/self/status") -> Optional[float]:
    """Resident memory in MB, or None where /proc is unavailable (Windows, macOS)."""
    try:
        with open(status_path, encoding="ascii", errors="ignore") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except (OSError, ValueError, IndexError):
        return None
    return None
