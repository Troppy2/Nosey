"""Reading this process's resident memory, used to pace batched PDF reads."""
from __future__ import annotations

from src.utils.process_memory import process_rss_mb

_STATUS = """Name:\tuvicorn
VmPeak:\t  612340 kB
VmSize:\t  598112 kB
VmHWM:\t  301232 kB
VmRSS:\t  262144 kB
Threads:\t4
"""


def test_reads_resident_memory_in_megabytes(tmp_path) -> None:
    status = tmp_path / "status"
    status.write_text(_STATUS)

    assert process_rss_mb(str(status)) == 256.0


def test_returns_none_where_proc_is_unavailable(tmp_path) -> None:
    # Windows and macOS dev machines have no /proc; batching then goes ahead.
    assert process_rss_mb(str(tmp_path / "missing")) is None


def test_returns_none_when_the_rss_line_is_missing(tmp_path) -> None:
    status = tmp_path / "status"
    status.write_text("Name:\tuvicorn\nThreads:\t4\n")

    assert process_rss_mb(str(status)) is None
