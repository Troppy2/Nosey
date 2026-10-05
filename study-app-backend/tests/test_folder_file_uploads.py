"""Folder file upload route: temp-file handoff, duplicate checks, progress fields."""
from __future__ import annotations

import asyncio
import hashlib
import tempfile
import time
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
from src.routes import folder_files, practice_problems
from src.services import file_service
from src.services.file_service import ExtractionResult, FileService, ParseProgress, ParseTimeoutError
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
    """Replace the background parse with a recorder that snapshots its temp file.

    The recording happens when the route builds the coroutine, so it does not
    depend on when the detached task gets scheduled.
    """
    calls: list[dict] = []

    def fake_extract_and_update(file_id, path, file_name, folder_id, user_id):
        with open(path, "rb") as handle:
            calls.append({"file_id": file_id, "path": path, "bytes": handle.read(), "file_name": file_name})
        return asyncio.sleep(0)

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


async def test_parse_is_detached_not_a_background_task(client, seeded, temp_dir, monkeypatch) -> None:
    """Rule 8a: BackgroundTasks would hold this connection for the whole parse,
    and Create Test's next request (POST /tests) would queue behind it."""
    spawned: list = []

    def record(coro):
        spawned.append(coro)
        coro.close()

    monkeypatch.setattr(folder_files, "spawn_detached", record)

    response = await client.post(
        f"/folders/{seeded.folder_id}/files",
        files=[
            ("files", ("a.pdf", b"%PDF-1.4 one", "application/pdf")),
            ("files", ("b.txt", b"two", "text/plain")),
        ],
    )

    assert response.status_code == 201
    assert len(spawned) == 2


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
    existing_id = await _add_row(
        db_session_maker, seeded.folder_id, upload_status="ready", raw_hash=hashlib.sha256(data).hexdigest()
    )

    response = await client.post(
        f"/folders/{seeded.folder_id}/files",
        files={"files": ("copy.pdf", data, "application/pdf")},
    )

    body = response.json()
    assert body["uploaded"] == []
    assert body["skipped"] == [{
        "file_name": "copy.pdf",
        "reason": "Identical file already exists as 'orig.pdf'",
        "existing_file_id": existing_id,
    }]
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
    monkeypatch.setattr(folder_files, "PDF_BOOK_MAX_PAGES", 300)
    file_id = await _add_row(background_db, seeded.folder_id, file_name="long.pdf")
    seen: list[tuple] = []

    async def fake_extract_from_path(self, path, file_name, *, on_progress=None, **page_range):
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

    async def fake_extract_from_path(self, path, file_name, *, on_progress=None, **page_range):
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

    async def failing_extract_from_path(self, path, file_name, *, on_progress=None, **page_range):
        raise ValidationException("No text could be extracted from the PDF")

    monkeypatch.setattr(FileService, "extract_from_path", failing_extract_from_path)
    path = _temp_upload(tmp_path)

    await folder_files._extract_and_update(file_id, path, "orig.pdf", seeded.folder_id, seeded.user_id)

    row = await _row(background_db, file_id)
    assert (row.upload_status, row.upload_error) == ("error", "No text could be extracted from the PDF")
    assert not Path(path).exists()


# --- batched reading of long PDFs (GH #121) -----------------------------------------

STOPPED_NOTE = "Read the first {} of {} pages. Delete this file and upload it again to read the rest."


class _FakeBook:
    """Stands in for FileService.extract_from_path over a long PDF, one batch per call."""

    def __init__(self, page_count: int, batch: int = 300, fail_at: int | None = None, during=None) -> None:
        self.page_count = page_count
        self.batch = batch
        self.fail_at = fail_at
        self.during = during  # async hook(start_page, on_progress) run inside each batch
        self.calls: list[dict] = []

    async def __call__(self, path, file_name, *, on_progress=None, start_page=0, max_pages=300):
        self.calls.append({"start_page": start_page, "max_pages": max_pages})
        if start_page == self.fail_at:
            raise ParseTimeoutError()
        if self.during is not None:
            await self.during(start_page, on_progress)
        end = min(start_page + self.batch, self.page_count, max_pages)
        return ExtractionResult(f"pages {start_page}-{end}", "pdf", pages_read=end, page_count=self.page_count)


@pytest.fixture
def plenty_of_memory(monkeypatch):
    monkeypatch.setattr(folder_files, "process_rss_mb", lambda: 200.0)


async def test_long_pdf_is_ready_after_the_first_batch_then_read_in_batches(
    background_db, seeded, tmp_path, monkeypatch, plenty_of_memory
) -> None:
    file_id = await _add_row(background_db, seeded.folder_id, file_name="textbook.pdf")
    seen: list[tuple] = []

    async def during(start_page, on_progress):
        if start_page == 300:
            row = await _row(background_db, file_id)
            seen.append((row.upload_status, row.content, row.pages_done, row.pages_total, row.upload_note))
            await on_progress(ParseProgress(0, None))  # the batch got its parse slot
            await on_progress(ParseProgress(420, 812))
            row = await _row(background_db, file_id)
            seen.append((row.upload_status, row.pages_done, row.pages_total))

    book = _FakeBook(812, during=during)
    monkeypatch.setattr(FileService, "extract_from_path", book)
    path = _temp_upload(tmp_path)

    await folder_files._extract_and_update(file_id, path, "textbook.pdf", seeded.folder_id, seeded.user_id)

    assert [c["start_page"] for c in book.calls] == [0, 300, 600]
    assert all(c["max_pages"] == 1500 for c in book.calls)
    # Usable after batch 1; "still reading" is a ready row with pages_done < pages_total.
    assert seen == [("ready", "pages 0-300", 300, 812, None), ("ready", 420, 812)]
    row = await _row(background_db, file_id)
    assert row.upload_status == "ready"
    assert row.content == "pages 0-300\n\npages 300-600\n\npages 600-812"
    assert row.content_hash == hashlib.sha256(row.content.encode("utf-8")).hexdigest()
    assert (row.pages_done, row.pages_total, row.upload_note) == (812, 812, None)
    assert not Path(path).exists()


async def test_a_book_past_the_page_ceiling_gets_the_cap_note(
    background_db, seeded, tmp_path, monkeypatch, plenty_of_memory
) -> None:
    file_id = await _add_row(background_db, seeded.folder_id)
    book = _FakeBook(2000)
    monkeypatch.setattr(FileService, "extract_from_path", book)

    await folder_files._extract_and_update(file_id, _temp_upload(tmp_path), "big.pdf", seeded.folder_id, seeded.user_id)

    assert [c["start_page"] for c in book.calls] == [0, 300, 600, 900, 1200]
    row = await _row(background_db, file_id)
    assert (row.pages_done, row.pages_total) == (1500, 1500)
    assert row.upload_note == "Read the first 1500 of 2000 pages."


async def test_batches_wait_for_memory_then_carry_on(
    background_db, seeded, tmp_path, monkeypatch
) -> None:
    file_id = await _add_row(background_db, seeded.folder_id)
    readings = iter([420.0, 410.0, 200.0])
    monkeypatch.setattr(folder_files, "process_rss_mb", lambda: next(readings, 200.0))
    monkeypatch.setattr(folder_files, "BATCH_MEMORY_RETRY_S", 0)
    book = _FakeBook(500)
    monkeypatch.setattr(FileService, "extract_from_path", book)

    await folder_files._extract_and_update(file_id, _temp_upload(tmp_path), "b.pdf", seeded.folder_id, seeded.user_id)

    assert [c["start_page"] for c in book.calls] == [0, 300]
    row = await _row(background_db, file_id)
    assert (row.pages_done, row.pages_total, row.upload_note) == (500, 500, None)


async def test_batches_stop_with_a_note_when_memory_stays_high(
    background_db, seeded, tmp_path, monkeypatch
) -> None:
    file_id = await _add_row(background_db, seeded.folder_id)
    monkeypatch.setattr(folder_files, "process_rss_mb", lambda: 480.0)
    monkeypatch.setattr(folder_files, "BATCH_MEMORY_RETRY_S", 0)
    book = _FakeBook(812)
    monkeypatch.setattr(FileService, "extract_from_path", book)
    path = _temp_upload(tmp_path)

    await folder_files._extract_and_update(file_id, path, "b.pdf", seeded.folder_id, seeded.user_id)

    assert [c["start_page"] for c in book.calls] == [0]
    row = await _row(background_db, file_id)
    assert (row.upload_status, row.content) == ("ready", "pages 0-300")
    assert (row.pages_done, row.pages_total) == (300, 300)
    assert row.upload_note == STOPPED_NOTE.format(300, 812)
    assert not Path(path).exists()


async def test_a_failed_later_batch_keeps_what_was_read(
    background_db, seeded, tmp_path, monkeypatch, plenty_of_memory
) -> None:
    file_id = await _add_row(background_db, seeded.folder_id)
    book = _FakeBook(1000, fail_at=600)
    monkeypatch.setattr(FileService, "extract_from_path", book)

    await folder_files._extract_and_update(file_id, _temp_upload(tmp_path), "b.pdf", seeded.folder_id, seeded.user_id)

    row = await _row(background_db, file_id)
    assert (row.upload_status, row.upload_error) == ("ready", None)
    assert row.content == "pages 0-300\n\npages 300-600"
    assert (row.pages_done, row.pages_total) == (600, 600)
    assert row.upload_note == STOPPED_NOTE.format(600, 1000)


async def test_deleting_the_file_mid_book_stops_reading(
    background_db, seeded, tmp_path, monkeypatch, plenty_of_memory
) -> None:
    file_id = await _add_row(background_db, seeded.folder_id)

    async def during(start_page, on_progress):
        if start_page == 300:
            async with background_db() as session:
                await session.delete(await session.get(FolderFile, file_id))
                await session.commit()

    book = _FakeBook(1200, during=during)
    monkeypatch.setattr(FileService, "extract_from_path", book)
    path = _temp_upload(tmp_path)

    await folder_files._extract_and_update(file_id, path, "b.pdf", seeded.folder_id, seeded.user_id)

    assert [c["start_page"] for c in book.calls] == [0, 300]
    assert await _row(background_db, file_id) is None
    assert not Path(path).exists()


async def test_a_queued_upload_is_read_between_batches(
    background_db, seeded, tmp_path, monkeypatch, plenty_of_memory
) -> None:
    # The parse slot is released after every batch, so one textbook cannot hold
    # it for an hour while other uploads wait.
    monkeypatch.setattr(file_service, "PDF_PAGE_CAP", 2)
    monkeypatch.setattr(folder_files, "PDF_BOOK_MAX_PAGES", 6)
    order: list[tuple[str, int]] = []

    def fake_pdf_pages(source, progress, deadline=None, clock=None, *, start=0, batch=2, max_pages=2):
        name = Path(source).stem
        order.append((name, start))
        time.sleep(0.05)
        count = 6 if name == "book" else 2
        stop = min(start + batch, count, max_pages)
        progress.pages_done, progress.pages_total = stop, min(count, max_pages)
        return file_service.PdfText(f"{name} text {start}", stop, count)

    monkeypatch.setattr(file_service, "_extract_pdf_pages", fake_pdf_pages)
    book_id = await _add_row(background_db, seeded.folder_id, file_name="book.pdf")
    notes_id = await _add_row(background_db, seeded.folder_id, file_name="notes.pdf")
    book_path, notes_path = tmp_path / "book.pdf", tmp_path / "notes.pdf"
    book_path.write_bytes(b"%PDF-1.4 book")
    notes_path.write_bytes(b"%PDF-1.4 notes")

    book_task = asyncio.create_task(
        folder_files._extract_and_update(book_id, str(book_path), "book.pdf", seeded.folder_id, seeded.user_id)
    )
    await asyncio.sleep(0.02)  # the book's first batch holds the slot
    await folder_files._extract_and_update(notes_id, str(notes_path), "notes.pdf", seeded.folder_id, seeded.user_id)
    await book_task

    assert order == [("book", 0), ("notes", 0), ("book", 2), ("book", 4)]
    assert (await _row(background_db, book_id)).content == "book text 0\n\nbook text 2\n\nbook text 4"


# --- practice test sections (GH #133) -------------------------------------------------

_SECTIONED = (
    "PART I. MULTIPLE CHOICE\n1. First question here?\nA. yes\nB. no\n\n"
    "PART II. WRITTEN\n2. Second question here?\n3. Third question here?\n"
)


async def test_sections_endpoint_lists_parts(client, seeded, db_session_maker) -> None:
    file_id = await _add_row(db_session_maker, seeded.folder_id, upload_status="ready", content=_SECTIONED)

    response = await client.get(f"/folders/{seeded.folder_id}/files/{file_id}/sections")

    assert response.status_code == 200
    assert response.json() == [
        {"index": 0, "title": "PART I. MULTIPLE CHOICE", "question_count": 1},
        {"index": 1, "title": "PART II. WRITTEN", "question_count": 2},
    ]


async def test_sections_endpoint_waits_for_the_parse(client, seeded, db_session_maker) -> None:
    file_id = await _add_row(db_session_maker, seeded.folder_id, upload_status="processing")

    response = await client.get(f"/folders/{seeded.folder_id}/files/{file_id}/sections")

    assert response.status_code == 409


# --- practice test problem picker (GH #138) -------------------------------------------

_WORKSHEET = (
    "# Chapter 1\n\n### 1.1 Vector equations PRIORITY\n\nIs (1, 2) = (2, 1)?\n\n"
    "### 1.2 Overloading\n\nWhich expressions are correct?\n(a) b = (0, a).\n(b) a = (0, b).\n"
)


async def test_problems_endpoint_lists_problems(client, seeded, db_session_maker) -> None:
    file_id = await _add_row(db_session_maker, seeded.folder_id, upload_status="ready", content=_WORKSHEET)

    response = await client.get(f"/folders/{seeded.folder_id}/files/{file_id}/problems")

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "headings"
    assert [(p["label"], p["title"], p["chapter"], p["part_count"]) for p in body["problems"]] == [
        ("1.1", "Vector equations", "Chapter 1", 0),
        ("1.2", "Overloading", "Chapter 1", 2),
    ]


async def test_problems_endpoint_falls_back_to_the_ai_index(client, seeded, db_session_maker, monkeypatch) -> None:
    text = "Tell me about photosynthesis in plants.\n\nNow explain the Krebs cycle in detail.\n"
    file_id = await _add_row(db_session_maker, seeded.folder_id, upload_status="ready", content=text)

    async def fake_index(self, content, provider=None):
        return [(0, "Q1", "Photosynthesis"), (content.index("Now explain"), "Q2", "Krebs cycle")]

    monkeypatch.setattr(practice_problems.LLMService, "index_practice_problems", fake_index)
    response = await client.get(f"/folders/{seeded.folder_id}/files/{file_id}/problems")

    body = response.json()
    assert body["source"] == "ai"
    assert [p["label"] for p in body["problems"]] == ["Q1", "Q2"]


async def test_parse_problems_reads_only_the_picked_ranges(client, seeded, db_session_maker, monkeypatch) -> None:
    from src.services.llm_service import GeneratedFRQ

    file_id = await _add_row(db_session_maker, seeded.folder_id, upload_status="ready", content=_WORKSHEET)
    problems = (await client.get(f"/folders/{seeded.folder_id}/files/{file_id}/problems")).json()["problems"]
    seen: list = []

    async def fake_parse(self, items, answer_key="", provider=None):
        seen.extend(items)
        return {items[0][0]: ([], [GeneratedFRQ("Is (1, 2) = (2, 1)?", "False", True)])}

    async def fake_solve(self, mcq, frq, context=""):
        # The review shows the solved answer, so Generate never solves again.
        from dataclasses import replace

        return mcq, [replace(q, expected_answer="False: order matters") for q in frq]

    monkeypatch.setattr(practice_problems.LLMService, "parse_practice_problems", fake_parse)
    monkeypatch.setattr(practice_problems.LLMService, "_solve_keyless_questions", fake_solve)
    picked = problems[0]
    response = await client.post(
        f"/folders/{seeded.folder_id}/files/{file_id}/problems/parse",
        json={"problems": [{"index": 0, "label": "1.1", "start": picked["start"], "end": picked["end"]}]},
    )

    assert response.status_code == 200
    assert len(seen) == 1 and "Overloading" not in seen[0][2] and "PRIORITY" not in seen[0][2]
    parsed = response.json()["problems"][0]
    assert parsed["questions"][0]["kind"] == "frq"
    assert parsed["questions"][0]["answer_inferred"] is True
    assert parsed["questions"][0]["expected_answer"] == "False: order matters"


async def test_parse_problems_rejects_a_range_outside_the_file(client, seeded, db_session_maker) -> None:
    file_id = await _add_row(db_session_maker, seeded.folder_id, upload_status="ready", content=_WORKSHEET)

    response = await client.post(
        f"/folders/{seeded.folder_id}/files/{file_id}/problems/parse",
        json={"problems": [{"index": 0, "start": 0, "end": 99_999}]},
    )

    assert response.status_code == 400


async def test_fix_problem_returns_the_redone_questions(client, seeded, db_session_maker, monkeypatch) -> None:
    from src.services.llm_service import GeneratedMCQ

    file_id = await _add_row(db_session_maker, seeded.folder_id, upload_status="ready", content=_WORKSHEET)
    got: dict = {}

    async def fake_fix(self, source, current, message, answer_key="", provider=None, label=""):
        got.update(source=source, current=current, message=message)
        return [GeneratedMCQ("Is (1, 2) = (2, 1)?", ["True", "False"], 1, True)], []

    async def fake_solve(self, mcq, frq, context=""):
        return mcq, frq

    monkeypatch.setattr(practice_problems.LLMService, "fix_practice_problem", fake_fix)
    monkeypatch.setattr(practice_problems.LLMService, "_solve_keyless_questions", fake_solve)
    response = await client.post(
        f"/folders/{seeded.folder_id}/files/{file_id}/problems/fix",
        json={
            "start": 0, "end": _WORKSHEET.index("### 1.2"),
            "current": [{"kind": "frq", "question_text": "Is (1, 2)?", "expected_answer": "No"}],
            "message": "make it true/false",
        },
    )

    assert response.status_code == 200
    assert response.json()["questions"][0]["options"] == ["True", "False"]
    assert got["message"] == "make it true/false" and "Answer: No" in got["current"]
