"""Folder file upload route: temp-file handoff, duplicate checks, progress fields."""
from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import AsyncClient

from src.database import get_session
from src.dependencies import get_current_user
from src.main import app
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.user import User
from src.routes import folder_files
from src.services.file_service import ExtractionResult, FileService, ParseProgress
from src.utils.exceptions import ValidationException

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def seeded(db_session_maker):
    async with db_session_maker() as session:
        user = User(email="uploader@example.com", google_id="g-uploader")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="Biology")
        session.add(folder)
        await session.commit()
        return SimpleNamespace(user_id=user.id, folder_id=folder.id)


@pytest_asyncio.fixture
async def client(db_session_maker, seeded):
    async def _session():
        async with db_session_maker() as session:
            yield session

    async def _user():
        return SimpleNamespace(id=seeded.user_id)

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(app=app, base_url="http://test") as http:
            yield http
    finally:
        app.dependency_overrides.clear()


async def test_file_list_includes_progress_and_note_fields(client, db_session_maker, seeded) -> None:
    async with db_session_maker() as session:
        session.add(
            FolderFile(
                folder_id=seeded.folder_id,
                file_name="long.pdf",
                file_type="pdf",
                size_bytes=10,
                content="text",
                content_hash="h",
                upload_status="ready",
                upload_note="Read the first 300 of 812 pages.",
                pages_done=300,
                pages_total=300,
                raw_hash="a" * 64,
            )
        )
        await session.commit()

    response = await client.get(f"/folders/{seeded.folder_id}/files")

    assert response.status_code == 200
    row = response.json()[0]
    assert row["upload_note"] == "Read the first 300 of 812 pages."
    assert (row["pages_done"], row["pages_total"]) == (300, 300)
    assert "raw_hash" not in row


# --- upload route: temp-file handoff and duplicates -------------------------------


@pytest.fixture
def temp_dir(monkeypatch, tmp_path):
    """Route temp uploads into an isolated directory so leftovers are visible."""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    return tmp_path


@pytest.fixture
def captured_tasks(monkeypatch):
    """Replace the background parse with a recorder that snapshots its temp file."""
    calls: list[dict] = []

    async def fake_extract_and_update(file_id, path, file_name, folder_id, user_id):
        with open(path, "rb") as handle:
            calls.append({"file_id": file_id, "path": path, "bytes": handle.read(), "file_name": file_name})

    monkeypatch.setattr(folder_files, "_extract_and_update", fake_extract_and_update)
    return calls


async def _add_row(db_session_maker, folder_id: int, **fields) -> int:
    values = {
        "file_name": "orig.pdf",
        "file_type": "pdf",
        "size_bytes": 10,
        "content": "",
        "content_hash": "",
        "upload_status": "processing",
    }
    values.update(fields)
    async with db_session_maker() as session:
        row = FolderFile(folder_id=folder_id, **values)
        session.add(row)
        await session.commit()
        return row.id


async def test_background_parse_receives_a_temp_file_path_not_bytes(client, seeded, temp_dir, captured_tasks) -> None:
    response = await client.post(
        f"/folders/{seeded.folder_id}/files",
        files={"files": ("notes.pdf", b"%PDF-1.4 lecture notes", "application/pdf")},
    )

    assert response.status_code == 201
    assert len(response.json()["uploaded"]) == 1
    (call,) = captured_tasks
    assert isinstance(call["path"], str)
    assert Path(call["path"]).name.startswith("nosey-upload-")
    assert call["bytes"] == b"%PDF-1.4 lecture notes"
    assert call["file_name"] == "notes.pdf"


async def test_oversized_file_is_skipped_and_its_temp_file_removed(
    client, seeded, temp_dir, captured_tasks, monkeypatch
) -> None:
    monkeypatch.setattr(folder_files, "MAX_UPLOAD_FILE_SIZE_BYTES", 16)

    response = await client.post(
        f"/folders/{seeded.folder_id}/files",
        files={"files": ("big.pdf", b"x" * 17, "application/pdf")},
    )

    body = response.json()
    assert body["uploaded"] == []
    assert body["skipped"][0]["reason"].startswith("Exceeds")
    assert captured_tasks == []
    assert list(temp_dir.iterdir()) == []


async def test_exact_reupload_is_rejected_before_parsing(
    client, seeded, db_session_maker, temp_dir, captured_tasks
) -> None:
    data = b"%PDF-1.4 the same file twice"
    await _add_row(
        db_session_maker, seeded.folder_id, upload_status="ready", raw_hash=hashlib.sha256(data).hexdigest()
    )

    response = await client.post(
        f"/folders/{seeded.folder_id}/files",
        files={"files": ("copy.pdf", data, "application/pdf")},
    )

    body = response.json()
    assert body["uploaded"] == []
    assert body["skipped"] == [{"file_name": "copy.pdf", "reason": "Identical file already exists as 'orig.pdf'"}]
    assert captured_tasks == []
    assert list(temp_dir.iterdir()) == []


async def test_reupload_of_a_failed_file_is_accepted(
    client, seeded, db_session_maker, temp_dir, captured_tasks
) -> None:
    data = b"%PDF-1.4 failed last time"
    await _add_row(
        db_session_maker, seeded.folder_id, upload_status="error", raw_hash=hashlib.sha256(data).hexdigest()
    )

    response = await client.post(
        f"/folders/{seeded.folder_id}/files",
        files={"files": ("orig.pdf", data, "application/pdf")},
    )

    assert len(response.json()["uploaded"]) == 1
    assert len(captured_tasks) == 1


# --- background parse --------------------------------------------------------------


@pytest.fixture
def background_db(monkeypatch, db_session_maker):
    monkeypatch.setattr(folder_files, "async_session_maker", db_session_maker)
    return db_session_maker


def _temp_upload(tmp_path: Path, data: bytes = b"%PDF-1.4 notes") -> str:
    path = tmp_path / "nosey-upload-abc.pdf"
    path.write_bytes(data)
    return str(path)


async def _row(db_session_maker, file_id: int) -> FolderFile:
    async with db_session_maker() as session:
        return await session.get(FolderFile, file_id)


async def test_background_parse_records_progress_and_the_page_cap_note(
    background_db, seeded, tmp_path, monkeypatch
) -> None:
    file_id = await _add_row(background_db, seeded.folder_id, file_name="long.pdf")
    seen: list[tuple] = []

    async def fake_extract_from_path(self, path, file_name, *, on_progress=None):
        await on_progress(ParseProgress(0, None))
        row = await _row(background_db, file_id)
        seen.append((row.upload_status, row.pages_done, row.pages_total))
        await on_progress(ParseProgress(120, 300))
        row = await _row(background_db, file_id)
        seen.append((row.upload_status, row.pages_done, row.pages_total))
        return ExtractionResult("Cell biology notes", "pdf", pages_read=300, page_count=812)

    monkeypatch.setattr(FileService, "extract_from_path", fake_extract_from_path)
    path = _temp_upload(tmp_path)

    await folder_files._extract_and_update(file_id, path, "long.pdf", seeded.folder_id, seeded.user_id)

    assert seen == [("processing", 0, None), ("processing", 120, 300)]
    row = await _row(background_db, file_id)
    assert row.upload_status == "ready"
    assert row.content == "Cell biology notes"
    assert (row.pages_done, row.pages_total) == (300, 300)
    assert row.upload_note == "Read the first 300 of 812 pages."
    assert not Path(path).exists()


async def test_background_parse_success_overrides_an_earlier_sweep(
    background_db, seeded, tmp_path, monkeypatch
) -> None:
    # During a deploy overlap the new instance's boot sweep can flip a row the old
    # instance is still parsing. The old instance's real result must win.
    file_id = await _add_row(background_db, seeded.folder_id)

    async def fake_extract_from_path(self, path, file_name, *, on_progress=None):
        async with background_db() as session:
            row = await session.get(FolderFile, file_id)
            row.upload_status = "error"
            row.upload_error = "Upload interrupted. Please try again."
            await session.commit()
        return ExtractionResult("Short notes", "txt")

    monkeypatch.setattr(FileService, "extract_from_path", fake_extract_from_path)

    await folder_files._extract_and_update(file_id, _temp_upload(tmp_path), "orig.pdf", seeded.folder_id, seeded.user_id)

    row = await _row(background_db, file_id)
    assert (row.upload_status, row.upload_error, row.upload_note) == ("ready", None, None)


async def test_background_parse_failure_marks_the_row_and_removes_the_temp_file(
    background_db, seeded, tmp_path, monkeypatch
) -> None:
    file_id = await _add_row(background_db, seeded.folder_id)

    async def failing_extract_from_path(self, path, file_name, *, on_progress=None):
        raise ValidationException("No text could be extracted from the PDF")

    monkeypatch.setattr(FileService, "extract_from_path", failing_extract_from_path)
    path = _temp_upload(tmp_path)

    await folder_files._extract_and_update(file_id, path, "orig.pdf", seeded.folder_id, seeded.user_id)

    row = await _row(background_db, file_id)
    assert (row.upload_status, row.upload_error) == ("error", "No text could be extracted from the PDF")
    assert not Path(path).exists()
