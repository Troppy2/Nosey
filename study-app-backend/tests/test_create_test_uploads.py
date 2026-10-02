"""Test creation hands uploaded files to its background task as temp files."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import AsyncClient

from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.main import app
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.test import Test as TestRow
from src.models.user import User
from src.routes import tests as tests_route
from src.services.file_service import ExtractionResult, FileService
from src.utils.exceptions import ValidationException

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def seeded(db_session_maker):
    async with db_session_maker() as session:
        user = User(email="maker@example.com", google_id="g-maker")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="Chemistry")
        session.add(folder)
        await session.flush()
        test = TestRow(folder_id=folder.id, title="Unit 1", test_type="MCQ_only")
        test.generation_status = "generating"
        session.add(test)
        await session.commit()
        return user, folder.id, test.id


@pytest.fixture
def temp_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    return tmp_path


@pytest.fixture
def spawned(monkeypatch):
    """Capture the detached generation coroutine instead of scheduling it."""
    calls: list[dict] = []
    coros: list = []

    async def fake_extract_and_generate_background(**kwargs):
        read = {}
        for path, name in kwargs["notes_paths"]:
            read[name] = Path(path).read_bytes()
        calls.append({**kwargs, "read": read})

    monkeypatch.setattr(tests_route, "_extract_and_generate_background", fake_extract_and_generate_background)
    monkeypatch.setattr(tests_route, "_spawn_generation", coros.append)
    quota = MagicMock()
    quota.return_value.charge_test = AsyncMock(return_value=None)
    monkeypatch.setattr(tests_route, "QuotaService", quota)
    return calls, coros


@pytest_asyncio.fixture
async def client(db_session_maker, seeded):
    user, _, _ = seeded

    async def _session():
        async with db_session_maker() as session:
            yield session

    async def _user():
        return user

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user] = _user
    # POST /folders/{id}/tests is limited to 5/minute per address, and every
    # test here posts from the same one.
    limiter.reset()
    try:
        async with AsyncClient(app=app, base_url="http://test") as http:
            yield http
    finally:
        app.dependency_overrides.clear()


async def test_create_test_streams_uploads_to_temp_files(client, seeded, temp_dir, spawned) -> None:
    _, folder_id, _ = seeded
    calls, coros = spawned

    response = await client.post(
        f"/folders/{folder_id}/tests",
        data={"title": "Quiz", "test_type": "MCQ_only"},
        files=[
            ("notes_files", ("a.pdf", b"%PDF-1.4 first", "application/pdf")),
            ("notes_files", ("b.txt", b"second file", "text/plain")),
        ],
    )

    assert response.status_code == 201, response.text
    (coro,) = coros
    await coro
    (call,) = calls
    assert [name for _, name in call["notes_paths"]] == ["a.pdf", "b.txt"]
    assert all(Path(path).name.startswith("nosey-upload-") for path, _ in call["notes_paths"])
    assert call["read"] == {"a.pdf": b"%PDF-1.4 first", "b.txt": b"second file"}
    assert call["practice_test_path"] is None


async def test_create_test_over_the_total_limit_removes_its_temp_files(
    client, seeded, temp_dir, spawned, monkeypatch
) -> None:
    _, folder_id, _ = seeded
    monkeypatch.setattr(tests_route, "MAX_UPLOAD_TOTAL_SIZE_BYTES", 10)

    response = await client.post(
        f"/folders/{folder_id}/tests",
        data={"title": "Quiz", "test_type": "MCQ_only"},
        files=[
            ("notes_files", ("a.txt", b"12345678", "text/plain")),
            ("notes_files", ("b.txt", b"87654321", "text/plain")),
        ],
    )

    assert response.status_code == 400
    assert "Combined uploaded files exceed" in response.json()["detail"]
    assert list(temp_dir.iterdir()) == []


# --- background extraction ---------------------------------------------------------


def _background_kwargs(seeded, notes_paths, practice_test_path=None) -> dict:
    user, folder_id, test_id = seeded
    return dict(
        test_id=test_id,
        user_id=user.id,
        folder_id=folder_id,
        notes_paths=notes_paths,
        practice_test_path=practice_test_path,
        use_folder_files=False,
        avoid_repeat=False,
        test_type="MCQ_only",
        count_mcq=5,
        count_frq=0,
        is_math_mode=False,
        difficulty="mixed",
        topic_focus=None,
        is_coding_mode=False,
        coding_language=None,
        custom_instructions=None,
        provider=None,
        enable_fallback=True,
    )


def _temp_file(tmp_path: Path, name: str, data: bytes) -> str:
    path = tmp_path / f"nosey-upload-{name}"
    path.write_bytes(data)
    return str(path)


@pytest.fixture
def background(monkeypatch, db_session_maker):
    monkeypatch.setattr(tests_route, "async_session_maker", db_session_maker)
    generate = AsyncMock(return_value=None)
    monkeypatch.setattr(tests_route, "_generate_questions_background", generate)

    async def fake_extract_from_path(self, path, file_name, *, on_progress=None):
        return ExtractionResult(f"text of {file_name}", "pdf")

    monkeypatch.setattr(FileService, "extract_from_path", fake_extract_from_path)
    return generate


async def test_background_extracts_from_temp_files_then_removes_them(background, seeded, tmp_path) -> None:
    notes = _temp_file(tmp_path, "notes.pdf", b"n")
    practice = _temp_file(tmp_path, "pt.pdf", b"p")

    await tests_route._extract_and_generate_background(
        **_background_kwargs(seeded, [(notes, "notes.pdf")], (practice, "pt.pdf"))
    )

    kwargs = background.await_args.kwargs
    assert "--- Document 1: notes.pdf ---\ntext of notes.pdf" in kwargs["notes_content"]
    assert "text of pt.pdf" in kwargs["practice_test_content"]
    assert not Path(notes).exists()
    assert not Path(practice).exists()


async def test_background_removes_temp_files_when_generation_raises(background, seeded, tmp_path) -> None:
    notes = _temp_file(tmp_path, "notes.pdf", b"n")
    background.side_effect = RuntimeError("provider exploded")

    with pytest.raises(RuntimeError):
        await tests_route._extract_and_generate_background(**_background_kwargs(seeded, [(notes, "notes.pdf")]))

    assert not Path(notes).exists()


async def test_background_extraction_failure_fails_the_test_and_removes_temp_files(
    background, seeded, tmp_path, monkeypatch, db_session_maker
) -> None:
    notes = _temp_file(tmp_path, "notes.pdf", b"n")

    async def failing_extract_from_path(self, path, file_name, *, on_progress=None):
        raise ValidationException("No text could be extracted from the PDF")

    monkeypatch.setattr(FileService, "extract_from_path", failing_extract_from_path)

    await tests_route._extract_and_generate_background(**_background_kwargs(seeded, [(notes, "notes.pdf")]))

    _, _, test_id = seeded
    async with db_session_maker() as session:
        test = await session.get(TestRow, test_id)
    assert test.generation_status == "failed"
    assert test.generation_error == "Could not read your files: No text could be extracted from the PDF"
    assert not Path(notes).exists()
    background.assert_not_awaited()


# --- files uploaded through the folder pipeline (file_ids) --------------------------


async def _folder_file(
    db_session_maker, folder_id: int, name: str, content: str = "", status: str = "ready", error=None
) -> int:
    async with db_session_maker() as session:
        row = FolderFile(
            folder_id=folder_id,
            file_name=name,
            file_type="pdf",
            size_bytes=max(len(content), 1),
            content=content,
            content_hash="",
            upload_status=status,
            upload_error=error,
        )
        session.add(row)
        await session.commit()
        return row.id


async def _expected_count(db_session_maker, test_id: int):
    async with db_session_maker() as session:
        return (await session.get(TestRow, test_id)).expected_question_count


async def test_create_with_file_ids_scopes_generation_to_those_files(
    client, seeded, db_session_maker, spawned
) -> None:
    _, folder_id, _ = seeded
    calls, coros = spawned
    picked = await _folder_file(db_session_maker, folder_id, "week1.pdf", "w1")
    await _folder_file(db_session_maker, folder_id, "old.pdf", "old")

    response = await client.post(
        f"/folders/{folder_id}/tests",
        data={"title": "Quiz", "test_type": "MCQ_only", "file_ids": str(picked)},
    )

    assert response.status_code == 201, response.text
    await coros[0]
    (call,) = calls
    assert call["folder_file_ids"] == [picked]
    assert call["use_folder_files"] is False
    assert call["practice_test_only"] is False
    assert await _expected_count(db_session_maker, response.json()["test_id"]) == 10


async def test_practice_test_file_defaults_to_recreate(client, seeded, db_session_maker, spawned) -> None:
    _, folder_id, _ = seeded
    calls, coros = spawned
    notes = await _folder_file(db_session_maker, folder_id, "notes.pdf", "n")
    exam = await _folder_file(db_session_maker, folder_id, "exam.pdf", "e")

    response = await client.post(
        f"/folders/{folder_id}/tests",
        data={"title": "Quiz", "test_type": "mixed", "file_ids": str(notes), "practice_test_file_id": str(exam)},
    )

    assert response.status_code == 201, response.text
    await coros[0]
    assert calls[0]["practice_test_file_id"] == exam
    assert calls[0]["practice_test_only"] is True
    # As many questions as the document has: unknown up front.
    assert await _expected_count(db_session_maker, response.json()["test_id"]) is None


async def test_style_mode_with_notes_uses_the_notes(client, seeded, db_session_maker, spawned) -> None:
    _, folder_id, _ = seeded
    calls, coros = spawned
    await _folder_file(db_session_maker, folder_id, "notes.pdf", "n")
    exam = await _folder_file(db_session_maker, folder_id, "exam.pdf", "e")

    response = await client.post(
        f"/folders/{folder_id}/tests",
        data={"title": "Quiz", "test_type": "mixed", "practice_test_file_id": str(exam), "practice_test_mode": "style"},
    )

    assert response.status_code == 201, response.text
    await coros[0]
    assert calls[0]["practice_test_only"] is False
    assert calls[0]["use_folder_files"] is True


async def test_style_mode_without_other_notes_stays_style(client, seeded, db_session_maker, spawned) -> None:
    """The practice test is the folder's only file, so there are no notes. A
    parallel version falls back to the exam's own topics (GH #133)."""
    _, folder_id, _ = seeded
    calls, coros = spawned
    exam = await _folder_file(db_session_maker, folder_id, "exam.pdf", "e")

    response = await client.post(
        f"/folders/{folder_id}/tests",
        data={"title": "Quiz", "test_type": "mixed", "practice_test_file_id": str(exam), "practice_test_mode": "style"},
    )

    assert response.status_code == 201, response.text
    await coros[0]
    assert calls[0]["practice_test_only"] is False


async def test_file_id_from_another_folder_is_rejected(client, seeded, db_session_maker, spawned) -> None:
    user, folder_id, _ = seeded
    _, coros = spawned
    async with db_session_maker() as session:
        other = Folder(user_id=user.id, name="Physics")
        session.add(other)
        await session.commit()
        other_id = other.id
    foreign = await _folder_file(db_session_maker, other_id, "theirs.pdf", "x")

    response = await client.post(
        f"/folders/{folder_id}/tests",
        data={"title": "Quiz", "test_type": "mixed", "file_ids": str(foreign)},
    )

    assert response.status_code == 404
    assert coros == []


async def test_background_waits_for_a_file_still_being_read(
    background, seeded, db_session_maker, monkeypatch
) -> None:
    _, folder_id, _ = seeded
    reading = await _folder_file(db_session_maker, folder_id, "week2.pdf", status="processing")
    await _folder_file(db_session_maker, folder_id, "unpicked.pdf", "not part of this test")
    real_sleep = asyncio.sleep
    polls: list[float] = []

    # The parse finishes while the task sleeps between polls. Done inside the
    # sleep, not as a concurrent task: the in-memory test DB shares one
    # connection, and two sessions interleaving on it deadlock.
    async def parse_finishes_during_the_wait(delay, *args, **kwargs):
        polls.append(delay)
        async with db_session_maker() as session:
            row = await session.get(FolderFile, reading)
            row.content = "week two notes"
            row.upload_status = "ready"
            await session.commit()
        await real_sleep(0)

    monkeypatch.setattr(asyncio, "sleep", parse_finishes_during_the_wait)
    await tests_route._extract_and_generate_background(
        **{**_background_kwargs(seeded, []), "folder_file_ids": [reading]}
    )
    monkeypatch.undo()

    assert polls == [tests_route._FOLDER_FILE_POLL_S]
    notes = background.await_args.kwargs["notes_content"]
    assert "week two notes" in notes
    assert "not part of this test" not in notes


async def test_background_recreate_mode_ignores_the_notes(background, seeded, db_session_maker) -> None:
    _, folder_id, _ = seeded
    notes = await _folder_file(db_session_maker, folder_id, "notes.pdf", "lecture notes")
    exam = await _folder_file(db_session_maker, folder_id, "exam.pdf", "1. What is 2+2?")

    await tests_route._extract_and_generate_background(**{
        **_background_kwargs(seeded, []),
        "folder_file_ids": [notes],
        "practice_test_file_id": exam,
        "practice_test_only": True,
    })

    kwargs = background.await_args.kwargs
    assert kwargs["notes_content"] == ""
    assert kwargs["practice_test_content"] == "1. What is 2+2?"


async def test_background_style_mode_does_not_treat_the_practice_test_as_notes(
    background, seeded, db_session_maker
) -> None:
    _, folder_id, _ = seeded
    await _folder_file(db_session_maker, folder_id, "notes.pdf", "lecture notes")
    exam = await _folder_file(db_session_maker, folder_id, "exam.pdf", "exam text")

    await tests_route._extract_and_generate_background(**{
        **_background_kwargs(seeded, []),
        "use_folder_files": True,
        "practice_test_file_id": exam,
    })

    kwargs = background.await_args.kwargs
    assert "lecture notes" in kwargs["notes_content"]
    assert "exam text" not in kwargs["notes_content"]
    assert kwargs["practice_test_content"] == "exam text"


async def test_background_unreadable_upload_fails_the_test_with_its_reason(
    background, seeded, db_session_maker
) -> None:
    _, folder_id, test_id = seeded
    broken = await _folder_file(
        db_session_maker, folder_id, "scan.pdf", status="error", error="No text could be extracted from the PDF"
    )

    await tests_route._extract_and_generate_background(
        **{**_background_kwargs(seeded, []), "folder_file_ids": [broken]}
    )

    async with db_session_maker() as session:
        test = await session.get(TestRow, test_id)
    assert test.generation_status == "failed"
    assert test.generation_error == "Could not read your files: scan.pdf: No text could be extracted from the PDF"
    background.assert_not_awaited()


async def test_background_uses_only_the_chosen_sections(background, seeded, db_session_maker) -> None:
    _, folder_id, _ = seeded
    exam = await _folder_file(
        db_session_maker, folder_id, "exam.pdf",
        "PART I\n1. First question here?\n\nPART II\n2. Second question here?\n",
    )

    await tests_route._extract_and_generate_background(**{
        **_background_kwargs(seeded, []),
        "practice_test_file_id": exam,
        "practice_test_only": True,
        "practice_test_sections": [1],
    })

    content = background.await_args.kwargs["practice_test_content"]
    assert "Second question" in content
    assert "First question" not in content
