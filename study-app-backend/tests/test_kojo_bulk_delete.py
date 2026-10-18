from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient

from src.database import get_session
from src.dependencies import get_current_user
from src.main import app
from src.services.kojo_service import KojoService


async def _override_session():
    yield AsyncMock()


async def _override_user():
    return SimpleNamespace(id=123)


async def test_bulk_delete_returns_deleted_count_scoped_to_user() -> None:
    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user
    try:
        with patch(
            "src.services.kojo_service.KojoService.bulk_delete_conversations",
            new=AsyncMock(return_value=2),
        ) as mocked:
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/kojo/conversations/bulk-delete", json={"ids": [4, 5, 6]})

        assert response.status_code == 200
        assert response.json() == {"deleted": 2}
        assert mocked.await_args.kwargs["user_id"] == 123
        assert mocked.await_args.kwargs["conversation_ids"] == [4, 5, 6]
    finally:
        app.dependency_overrides.clear()


async def test_bulk_delete_rejects_empty_and_oversized_lists() -> None:
    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user
    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            empty = await client.post("/kojo/conversations/bulk-delete", json={"ids": []})
            huge = await client.post("/kojo/conversations/bulk-delete", json={"ids": list(range(201))})
        assert empty.status_code == 422
        assert huge.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_service_dedupes_ids_and_commits() -> None:
    session = AsyncMock()
    with patch(
        "src.services.kojo_service.KojoRepository.delete_conversations",
        new=AsyncMock(return_value=2),
    ) as repo_delete:
        deleted = await KojoService().bulk_delete_conversations(
            user_id=7, conversation_ids=[1, 1, 2], session=session
        )
    assert deleted == 2
    ids, user_id = repo_delete.await_args.args
    assert sorted(ids) == [1, 2] and user_id == 7
    session.commit.assert_awaited_once()
