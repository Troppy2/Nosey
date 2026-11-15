"""Saved resume (one per user) and the ATS screen that can reuse it.

Exercised through httpx with get_session and get_current_user overridden, the
idiom in test_sd_routes.py. The LLM is patched at LLMService.complete_json, so
these also pin that the screen asks for JSON through the JSON path, not
call_kojo + json.loads (the "Expecting ':' delimiter" bug, 2026-11-14).
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.main import app
from src.models.mock_interview import MockInterviewSession
from src.models.user import User
from src.services.resume_service import load_saved_resume

RESUME = "Jane Doe\nSoftware Engineer Intern at Acme. Built a Python service handling 2M requests a day."

SCAN_JSON = {
    "ats_score": 74,
    "passes_oa": True,
    "verdict": "Solid resume",
    "matched_keywords": ["Python"],
    "missing_keywords": ["Go"],
    "strengths": ["Clear impact"],
    "gaps": ["No tests mentioned"],
    "fixes": ["Add a metric"],
    "summary": "Good fit.",
}


@pytest_asyncio.fixture
async def client(db_session_maker):
    session = db_session_maker()
    user = User(email="resume@example.com", google_id="google-resume", is_beta=True, is_admin=False)
    session.add(user)
    await session.commit()
    mock = MockInterviewSession(user_id=user.id, company="google", level="intern", status="pending")
    session.add(mock)
    await session.commit()

    async def _override_session():
        yield session

    async def _override_user():
        return user

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user
    limiter.enabled = False
    try:
        async with AsyncClient(app=app, base_url="http://test") as http_client:
            yield SimpleNamespace(http=http_client, session=session, user=user, mock_id=mock.id)
    finally:
        limiter.enabled = True
        app.dependency_overrides.clear()
        await session.close()


async def test_saved_resume_round_trip(client) -> None:
    assert (await client.http.get("/saved-resume")).json() is None

    put = await client.http.put("/saved-resume", data={"resume_text": RESUME})
    assert put.status_code == 200, put.text
    body = put.json()
    assert body["file_name"] is None
    assert body["chars"] == len(RESUME)
    assert body["updated_at"]

    got = (await client.http.get("/saved-resume")).json()
    assert got["chars"] == len(RESUME)

    assert (await client.http.delete("/saved-resume")).status_code == 204
    assert (await client.http.get("/saved-resume")).json() is None


async def test_saved_resume_rejects_too_short(client) -> None:
    response = await client.http.put("/saved-resume", data={"resume_text": "too short"})
    assert response.status_code == 400
    assert "resume" in response.json()["detail"].lower()


async def test_screen_uses_saved_resume_and_json_path(client) -> None:
    await client.http.put("/saved-resume", data={"resume_text": RESUME})
    fake = AsyncMock(return_value=SCAN_JSON)
    kojo = AsyncMock(side_effect=AssertionError("call_kojo must not be used for JSON"))
    with patch("src.services.llm_service.LLMService.complete_json", new=fake), \
            patch("src.services.llm_service.LLMService.call_kojo", new=kojo):
        response = await client.http.post(
            f"/mock-interview/{client.mock_id}/resume/screen", data={"use_saved": "true"}
        )
    assert response.status_code == 200, response.text
    assert response.json()["ats_score"] == 74
    assert RESUME in fake.await_args.args[0]

    row = (
        await client.session.execute(select(MockInterviewSession).where(MockInterviewSession.id == client.mock_id))
    ).scalar_one()
    assert row.resume_text == RESUME
    assert row.status == "resume_complete"


async def test_screen_use_saved_without_one_is_a_400(client) -> None:
    response = await client.http.post(
        f"/mock-interview/{client.mock_id}/resume/screen", data={"use_saved": "true"}
    )
    assert response.status_code == 400
    assert "saved resume" in response.json()["detail"].lower()


async def test_screen_save_resume_keeps_it_even_if_the_scan_fails(client) -> None:
    from src.utils.exceptions import LLMException

    with patch(
        "src.services.llm_service.LLMService.complete_json",
        new=AsyncMock(side_effect=LLMException("all providers down")),
    ):
        response = await client.http.post(
            f"/mock-interview/{client.mock_id}/resume/screen",
            data={"resume_text": RESUME, "save_resume": "true"},
        )
    assert response.status_code == 503
    # A friendly message, not the raw parser/provider error.
    assert "providers down" not in response.json()["detail"]
    saved = await load_saved_resume(client.session, client.user.id)
    assert saved is not None and saved.text == RESUME


async def test_screen_without_save_flag_does_not_touch_saved_resume(client) -> None:
    with patch("src.services.llm_service.LLMService.complete_json", new=AsyncMock(return_value=SCAN_JSON)):
        response = await client.http.post(
            f"/mock-interview/{client.mock_id}/resume/screen", data={"resume_text": RESUME}
        )
    assert response.status_code == 200
    assert await load_saved_resume(client.session, client.user.id) is None
