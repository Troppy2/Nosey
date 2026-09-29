"""Folder file upload route: temp-file handoff, duplicate checks, progress fields."""
from __future__ import annotations

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
