from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient

from src.database import get_session
from src.dependencies import get_current_user
from src.main import app
from src.repositories.kojo_repository import KojoRepository
from src.schemas.kojo_schema import (
    KojoClearResponse,
    KojoClearedConversationDTO,
    KojoRestoreResponse,
)
from src.utils.exceptions import ResourceNotFoundException


async def _override_session():
    yield AsyncMock()


async def _override_user():
    return SimpleNamespace(id=123)


async def test_clear_endpoint_returns_clear_payload() -> None:
    cleared_at = datetime(2026, 4, 29, 12, 0, 0)
    payload = KojoClearResponse(
        conversation_id=77,
        folder_id=9,
        cleared_at=cleared_at,
        restore_expires_at=cleared_at + timedelta(hours=5),
    )

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user

    try:
        with patch(
            "src.services.kojo_service.KojoService.clear_conversation",
            new=AsyncMock(return_value=payload),
        ):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/kojo/folders/9/clear")

        assert response.status_code == 200
        body = response.json()
        assert body["conversation_id"] == 77
        assert body["folder_id"] == 9
        assert body["cleared_at"].startswith("2026-04-29T12:00:00")
    finally:
        app.dependency_overrides.clear()


async def test_restore_endpoint_returns_restore_status() -> None:
    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user

    try:
        with patch(
            "src.services.kojo_service.KojoService.restore_conversation",
            new=AsyncMock(return_value=KojoRestoreResponse(folder_id=9, restored=True)),
        ):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/kojo/folders/9/restore")

        assert response.status_code == 200
        assert response.json() == {"folder_id": 9, "restored": True}
    finally:
        app.dependency_overrides.clear()


async def test_clear_endpoint_maps_resource_not_found_to_404() -> None:
    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user

    try:
        with patch(
            "src.services.kojo_service.KojoService.clear_conversation",
            new=AsyncMock(side_effect=ResourceNotFoundException("Folder")),
        ):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.post("/kojo/folders/999/clear")

        assert response.status_code == 404
        assert response.json()["detail"] == "Folder not found"
    finally:
        app.dependency_overrides.clear()


async def test_list_cleared_endpoint_returns_items() -> None:
    cleared_at = datetime(2026, 4, 29, 12, 0, 0)
    payload = [
        KojoClearedConversationDTO(
            conversation_id=21,
            folder_id=8,
            folder_name="Biology",
            cleared_at=cleared_at,
            restore_expires_at=cleared_at + timedelta(hours=5),
        )
    ]

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user

    try:
        with patch(
            "src.services.kojo_service.KojoService.get_cleared_conversations",
            new=AsyncMock(return_value=payload),
        ):
            async with AsyncClient(app=app, base_url="http://test") as client:
                response = await client.get("/kojo/conversations/cleared")

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["conversation_id"] == 21
        assert body[0]["folder_name"] == "Biology"
    finally:
        app.dependency_overrides.clear()


async def test_restore_conversation_restores_when_within_or_at_five_hours() -> None:
    fixed_now = datetime(2026, 4, 29, 17, 0, 0)
    conversation = SimpleNamespace(cleared_at=fixed_now - timedelta(hours=5))
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=conversation)
    session.flush = AsyncMock()

    repo = KojoRepository(session)

    with patch("src.repositories.kojo_repository.datetime") as datetime_mock:
        datetime_mock.utcnow.return_value = fixed_now
        restored = await repo.restore_conversation(user_id=1, folder_id=1)

    assert restored is True
    assert conversation.cleared_at is None
    session.flush.assert_awaited_once()


async def test_restore_conversation_fails_after_five_hour_window() -> None:
    fixed_now = datetime(2026, 4, 29, 17, 0, 0)
    original_cleared_at = fixed_now - timedelta(hours=5, seconds=1)
    conversation = SimpleNamespace(cleared_at=original_cleared_at)
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=conversation)
    session.flush = AsyncMock()

    repo = KojoRepository(session)

    with patch("src.repositories.kojo_repository.datetime") as datetime_mock:
        datetime_mock.utcnow.return_value = fixed_now
        restored = await repo.restore_conversation(user_id=1, folder_id=1)

    assert restored is False
    assert conversation.cleared_at == original_cleared_at
    session.flush.assert_not_awaited()
