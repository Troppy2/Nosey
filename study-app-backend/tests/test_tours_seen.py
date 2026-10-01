"""Page tours: /auth/tours-seen records and resets which tours an account saw.

Same harness as test_sd_routes.py: get_session and get_current_user are
overridden and the session is a real in-memory SQLite one.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest_asyncio
from httpx import AsyncClient

from src.database import get_session
from src.dependencies import get_current_user
from src.main import app
from src.models.user import User, parse_tours_seen


@pytest_asyncio.fixture
async def client(db_session_maker):
    session = db_session_maker()
    user = User(email="tours@example.com", google_id="google-tours")
    session.add(user)
    await session.commit()

    async def _override_session():
        yield session

    async def _override_user():
        return user

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user
    try:
        async with AsyncClient(app=app, base_url="http://test") as http_client:
            yield SimpleNamespace(http=http_client, session=session, user=user)
    finally:
        app.dependency_overrides.clear()
        await session.close()


async def test_new_user_has_seen_no_tours(client) -> None:
    response = await client.http.get("/auth/me")
    assert response.status_code == 200
    assert response.json()["tours_seen"] == []


async def test_marking_a_tour_is_recorded_once(client) -> None:
    for _ in range(2):
        response = await client.http.post("/auth/tours-seen", json={"tour_id": "create-test"})
        assert response.status_code == 200
    second = await client.http.post("/auth/tours-seen", json={"tour_id": "kojo"})
    assert second.json()["tours_seen"] == ["create-test", "kojo"]


async def test_malformed_tour_id_is_rejected(client) -> None:
    response = await client.http.post("/auth/tours-seen", json={"tour_id": "Create Test!"})
    assert response.status_code == 422


async def test_reset_clears_every_tour(client) -> None:
    await client.http.post("/auth/tours-seen", json={"tour_id": "folders"})
    response = await client.http.delete("/auth/tours-seen")
    assert response.status_code == 200
    assert response.json()["tours_seen"] == []


def test_parse_tours_seen_ignores_garbage() -> None:
    assert parse_tours_seen(None) == []
    assert parse_tours_seen("not json") == []
    assert parse_tours_seen('{"a": 1}') == []
    assert parse_tours_seen('["kojo", 7, null]') == ["kojo"]
