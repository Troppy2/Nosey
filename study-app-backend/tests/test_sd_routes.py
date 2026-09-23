"""System Design mode: endpoint contracts, validation, and status codes.

The app is exercised through httpx with get_session and get_current_user
overridden, following the idiom in test_kojo_clear_restore.py. The session
override hands out a real SQLite session so round trips are genuine.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from httpx import AsyncClient

from src.database import get_session
from src.dependencies import get_current_user
from src.main import app
from src.models.user import User
from src.utils.exceptions import LLMException


@pytest_asyncio.fixture
async def client(db_session_maker):
    session = db_session_maker()
    # System Design is beta-only, enforced server-side by get_beta_user.
    user = User(email="routes@example.com", google_id="google-routes", is_beta=True)
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


async def test_progress_endpoint_returns_empty_concepts_for_new_user(client) -> None:
    response = await client.http.get("/system-design/progress")
    assert response.status_code == 200
    assert response.json() == {"concepts": {}}


async def test_put_progress_rejects_a_submodule_it_does_not_own(client) -> None:
    """Only notes and video are client-assertable. The other three are earned."""
    for sub_module in ("visualizer", "project", "quiz"):
        response = await client.http.put(
            "/system-design/progress/caching",
            json={"subModule": sub_module, "done": True},
        )
        assert response.status_code == 400, sub_module


async def test_put_progress_rejects_a_malformed_concept_id(client) -> None:
    response = await client.http.put(
        "/system-design/progress/Caching!",
        json={"subModule": "notes", "done": True},
    )
    assert response.status_code == 400


async def test_submission_endpoints_reject_a_malformed_exercise_id(client) -> None:
    get_response = await client.http.get("/system-design/submissions/caching:quiz")
    assert get_response.status_code == 400

    put_response = await client.http.put(
        "/system-design/submissions/caching:quiz",
        json={"files": {}, "ranPassed": False},
    )
    assert put_response.status_code == 400


async def test_get_submission_returns_empty_files_when_absent(client) -> None:
    response = await client.http.get("/system-design/submissions/caching:visualizer")
    assert response.status_code == 200
    assert response.json() == {"files": {}, "lastRunPassed": False, "passedAt": None}


async def test_put_then_get_progress_round_trip(client) -> None:
    put_response = await client.http.put(
        "/system-design/progress/caching",
        json={"subModule": "notes", "done": True},
    )
    assert put_response.status_code == 204

    body = (await client.http.get("/system-design/progress")).json()
    assert body["concepts"]["caching"]["notesDone"] is True
    assert body["concepts"]["caching"]["videoDone"] is False
    assert body["concepts"]["caching"]["completedAt"] is None
    assert body["concepts"]["caching"]["quizBestScore"] is None


async def test_put_then_get_submission_round_trip(client) -> None:
    files = {"cache.py": "class Cache:\n    pass\n"}
    put_response = await client.http.put(
        "/system-design/submissions/caching:visualizer",
        json={"files": files, "ranPassed": True},
    )
    assert put_response.status_code == 204

    body = (await client.http.get("/system-design/submissions/caching:visualizer")).json()
    assert body["files"] == files
    assert body["lastRunPassed"] is True
    assert body["passedAt"] is not None

    progress = (await client.http.get("/system-design/progress")).json()
    assert progress["concepts"]["caching"]["visualizerDone"] is True


async def test_quiz_grade_rejects_a_request_without_five_written_answers(client) -> None:
    response = await client.http.post(
        "/system-design/quiz/caching/grade",
        json={"notes": "notes", "mcq": [], "frq": []},
    )
    assert response.status_code == 400
    assert "detail" in response.json()


async def test_quiz_grade_returns_503_when_grading_is_unavailable(client) -> None:
    with patch(
        "src.services.system_design_quiz_service.SystemDesignQuizService.grade",
        new=AsyncMock(side_effect=LLMException("Grading is temporarily unavailable.")),
    ):
        response = await client.http.post(
            "/system-design/quiz/caching/grade",
            json={"notes": "notes", "mcq": [], "frq": []},
        )
    assert response.status_code == 503


async def test_endpoints_require_authentication(db_session_maker) -> None:
    session = db_session_maker()

    async def _override_session():
        yield session

    app.dependency_overrides[get_session] = _override_session
    try:
        async with AsyncClient(app=app, base_url="http://test") as http_client:
            assert (await http_client.get("/system-design/progress")).status_code == 401
            assert (
                await http_client.put(
                    "/system-design/progress/caching", json={"subModule": "notes", "done": True}
                )
            ).status_code == 401
            assert (
                await http_client.get("/system-design/submissions/caching:visualizer")
            ).status_code == 401
            assert (
                await http_client.put(
                    "/system-design/submissions/caching:visualizer",
                    json={"files": {}, "ranPassed": False},
                )
            ).status_code == 401
    finally:
        app.dependency_overrides.clear()
        await session.close()


async def test_unhandled_service_error_returns_json_not_a_bare_500(client) -> None:
    """Unhandled exceptions bypass CORSMiddleware. Handlers must re-raise as
    HTTPException so the response carries a detail field and CORS headers."""
    with patch(
        "src.services.system_design_service.SystemDesignService.get_progress",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        response = await client.http.get("/system-design/progress")

    assert response.status_code == 500
    assert "detail" in response.json()


async def test_endpoints_reject_basic_users(db_session_maker) -> None:
    """Beta-only is a server-side boundary, not just a hidden nav item."""
    session = db_session_maker()
    user = User(email="basic@example.com", google_id="google-basic", is_beta=False, is_admin=False)
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
            assert (await http_client.get("/system-design/progress")).status_code == 403
            assert (
                await http_client.post("/system-design/quiz/caching/grade", json={})
            ).status_code == 403
            assert (await http_client.post("/leetcode/hint", json={})).status_code == 403
            assert (await http_client.post("/mock-interview/parse-jd", json={})).status_code == 403
            assert (await http_client.post("/folders/1/learning-track", json={})).status_code == 403
    finally:
        app.dependency_overrides.clear()
        await session.close()
