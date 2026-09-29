"""Recovering folder uploads whose background parse died with the process."""
from __future__ import annotations

import asyncio
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from src.main import app
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.user import User
from src.services import upload_recovery
from src.services.upload_recovery import sweep_stuck_uploads
from src.utils.temp_uploads import cleanup_stale_temp_uploads

INTERRUPTED = "Upload interrupted. Please try again."


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest_asyncio.fixture
async def folder_id(db_session_maker) -> int:
    async with db_session_maker() as session:
        user = User(email="sweep@example.com", google_id="g-sweep")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="Physics")
        session.add(folder)
        await session.commit()
        return folder.id


async def _add(db_session_maker, folder_id: int, status: str, age: timedelta = timedelta(0), error=None) -> int:
    async with db_session_maker() as session:
        row = FolderFile(
            folder_id=folder_id,
            file_name=f"{status}.pdf",
            file_type="pdf",
            size_bytes=1,
            content="",
            content_hash="",
            upload_status=status,
            upload_error=error,
            uploaded_at=_utc_now() - age,
        )
        session.add(row)
        await session.commit()
        return row.id


async def _status(db_session_maker, file_id: int) -> tuple:
    async with db_session_maker() as session:
        row = await session.get(FolderFile, file_id)
        return row.upload_status, row.upload_error


async def test_full_sweep_flips_every_processing_row_and_nothing_else(db_session_maker, folder_id) -> None:
    a = await _add(db_session_maker, folder_id, "processing")
    b = await _add(db_session_maker, folder_id, "processing", age=timedelta(hours=3))
    ready = await _add(db_session_maker, folder_id, "ready")
    failed = await _add(db_session_maker, folder_id, "error", error="No text could be extracted from the PDF")

    async with db_session_maker() as session:
        count = await sweep_stuck_uploads(session)

    assert count == 2
    assert await _status(db_session_maker, a) == ("error", INTERRUPTED)
    assert await _status(db_session_maker, b) == ("error", INTERRUPTED)
    assert await _status(db_session_maker, ready) == ("ready", None)
    assert await _status(db_session_maker, failed) == ("error", "No text could be extracted from the PDF")


async def test_threshold_sweep_only_flips_rows_older_than_it(db_session_maker, folder_id) -> None:
    old = await _add(db_session_maker, folder_id, "processing", age=timedelta(minutes=50))
    fresh = await _add(db_session_maker, folder_id, "processing", age=timedelta(minutes=10))

    async with db_session_maker() as session:
        count = await sweep_stuck_uploads(session, older_than=timedelta(minutes=45))

    assert count == 1
    assert await _status(db_session_maker, old) == ("error", INTERRUPTED)
    assert await _status(db_session_maker, fresh) == ("processing", None)


async def test_periodic_sweep_flips_old_rows_on_each_interval(db_session_maker, folder_id, monkeypatch) -> None:
    monkeypatch.setattr(upload_recovery, "async_session_maker", db_session_maker)
    old = await _add(db_session_maker, folder_id, "processing", age=timedelta(minutes=50))
    fresh = await _add(db_session_maker, folder_id, "processing", age=timedelta(minutes=10))
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) > 1:
            raise asyncio.CancelledError  # shutdown while waiting for the next round

    with pytest.raises(asyncio.CancelledError):
        await upload_recovery.run_periodic_sweep(interval_s=300, sleep=fake_sleep)

    assert sleeps == [300, 300]
    assert await _status(db_session_maker, old) == ("error", INTERRUPTED)
    assert await _status(db_session_maker, fresh) == ("processing", None)


def test_temp_cleanup_removes_only_stale_upload_files(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    stale = tmp_path / "nosey-upload-stale.pdf"
    recent = tmp_path / "nosey-upload-recent.pdf"
    unrelated = tmp_path / "someone-else.pdf"
    for path in (stale, recent, unrelated):
        path.write_bytes(b"x")
    two_hours_ago = time.time() - 2 * 60 * 60
    os.utime(stale, (two_hours_ago, two_hours_ago))

    assert cleanup_stale_temp_uploads(older_than_s=60 * 60) == 1
    assert sorted(p.name for p in tmp_path.iterdir()) == ["nosey-upload-recent.pdf", "someone-else.pdf"]

    assert cleanup_stale_temp_uploads() == 1
    assert [p.name for p in tmp_path.iterdir()] == ["someone-else.pdf"]


async def test_startup_recovers_uploads_and_runs_the_sweeper_until_shutdown(
    db_session_maker, folder_id, monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(upload_recovery, "async_session_maker", db_session_maker)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    (tmp_path / "nosey-upload-orphan.pdf").write_bytes(b"x")
    stuck = await _add(db_session_maker, folder_id, "processing")
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def fake_periodic_sweep() -> None:
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(upload_recovery, "run_periodic_sweep", fake_periodic_sweep)

    async with app.router.lifespan_context(app):
        # Every parse died with the old process, so the row is failed before any
        # request is served, and the orphaned temp file is gone.
        assert await _status(db_session_maker, stuck) == ("error", INTERRUPTED)
        assert list(tmp_path.iterdir()) == []
        await asyncio.wait_for(started.wait(), timeout=2)

    assert cancelled.is_set()


async def test_startup_survives_a_failing_recovery(monkeypatch, caplog) -> None:
    async def broken_sweep(session, older_than=None):
        raise ConnectionError("database unreachable")

    async def idle_periodic_sweep() -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(upload_recovery, "sweep_stuck_uploads", broken_sweep)
    monkeypatch.setattr(upload_recovery, "run_periodic_sweep", idle_periodic_sweep)

    async with app.router.lifespan_context(app):
        pass

    assert any("upload recovery" in record.getMessage().lower() for record in caplog.records)


async def test_startup_does_not_wait_forever_on_a_hung_database(monkeypatch) -> None:
    async def hung_sweep(session, older_than=None):
        await asyncio.Event().wait()

    async def idle_periodic_sweep() -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(upload_recovery, "sweep_stuck_uploads", hung_sweep)
    monkeypatch.setattr(upload_recovery, "run_periodic_sweep", idle_periodic_sweep)
    monkeypatch.setattr(upload_recovery, "BOOT_RECOVERY_TIMEOUT_S", 0.05)

    async def enter_and_leave() -> None:
        async with app.router.lifespan_context(app):
            pass

    await asyncio.wait_for(enter_and_leave(), timeout=5)
