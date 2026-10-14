"""MCP connector: OAuth 2.1 flow end to end, then the /mcp JSON-RPC transport."""
from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlsplit

import pytest
import pytest_asyncio
from httpx import AsyncClient

from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.main import app
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.user import User
from src.services.mcp_oauth_service import OAuthError, validate_redirect_uri

pytestmark = pytest.mark.asyncio

REDIRECT = "https://claude.ai/api/mcp/auth_callback"


@pytest_asyncio.fixture
async def seeded(db_session_maker):
    async with db_session_maker() as session:
        beta = User(email="beta@example.com", google_id="g-beta", is_beta=True)
        other = User(email="other@example.com", google_id="g-other", is_beta=True)
        session.add_all([beta, other])
        await session.flush()
        # is_archived set explicitly: SQLite stores the "false" server default as text.
        folder = Folder(user_id=beta.id, name="Chemistry", is_archived=False)
        foreign = Folder(user_id=other.id, name="Not yours", is_archived=False)
        session.add_all([folder, foreign])
        await session.flush()
        session.add(
            FolderFile(folder_id=folder.id, file_name="ch1.txt", file_type="txt", content="A" * 50 + "B" * 50)
        )
        await session.commit()
        return {"beta": beta, "other": other, "folder_id": folder.id, "foreign_id": foreign.id}


@pytest_asyncio.fixture
async def client(db_session_maker, seeded):
    state = {"user": seeded["beta"]}

    async def _session():
        async with db_session_maker() as session:
            yield session

    async def _user():
        return state["user"]

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user] = _user
    limiter.reset()
    try:
        async with AsyncClient(app=app, base_url="http://test") as http:
            http.state = state  # type: ignore[attr-defined]
            yield http
    finally:
        app.dependency_overrides.clear()


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


async def _connect(client: AsyncClient) -> dict:
    """Register, authorize, approve and redeem. Returns the token response + client_id."""
    reg = await client.post("/oauth/register", json={"client_name": "Claude", "redirect_uris": [REDIRECT]})
    assert reg.status_code == 201, reg.text
    client_id = reg.json()["client_id"]

    verifier, challenge = _pkce()
    auth = await client.get(
        "/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": "xyz",
            "scope": "nosey",
        },
    )
    assert auth.status_code == 302
    consent = urlsplit(auth.headers["location"])
    assert consent.path == "/connect/authorize"
    request_id = parse_qs(consent.query)["request"][0]

    info = await client.get(f"/oauth/requests/{request_id}")
    assert info.status_code == 200
    assert info.json()["client_name"] == "Claude"
    assert info.json()["redirect_host"] == "claude.ai"

    approved = await client.post(f"/oauth/requests/{request_id}/approve")
    assert approved.status_code == 200
    back = urlsplit(approved.json()["redirect_url"])
    assert f"{back.scheme}://{back.netloc}{back.path}" == REDIRECT
    query = parse_qs(back.query)
    assert query["state"] == ["xyz"]

    tok = await client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": query["code"][0],
            "client_id": client_id,
            "redirect_uri": REDIRECT,
            "code_verifier": verifier,
        },
    )
    assert tok.status_code == 200, tok.text
    body = tok.json()
    assert body["token_type"] == "Bearer" and body["access_token"] and body["refresh_token"]

    # A code works exactly once.
    again = await client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": query["code"][0],
            "client_id": client_id,
            "code_verifier": verifier,
        },
    )
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"
    return {**body, "client_id": client_id}


async def _rpc(client: AsyncClient, token: str, method: str, params: dict | None = None, msg_id: int = 1):
    return await client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params or {}},
        headers={"Authorization": f"Bearer {token}"},
    )


async def test_discovery_metadata(client) -> None:
    prm = (await client.get("/.well-known/oauth-protected-resource/mcp")).json()
    assert prm["resource"] == "http://test/mcp"
    assert prm["authorization_servers"] == ["http://test"]
    asm = (await client.get("/.well-known/oauth-authorization-server")).json()
    assert asm["code_challenge_methods_supported"] == ["S256"]
    assert asm["registration_endpoint"] == "http://test/oauth/register"
    # Behind Render's TLS proxy the forwarded scheme wins over the local http.
    proxied = (await client.get("/.well-known/oauth-authorization-server", headers={"X-Forwarded-Proto": "https"})).json()
    assert proxied["issuer"] == "https://test"


async def test_mcp_requires_token_and_points_at_metadata(client) -> None:
    resp = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert resp.status_code == 401
    assert 'resource_metadata="http://test/.well-known/oauth-protected-resource/mcp"' in resp.headers[
        "www-authenticate"
    ]
    bad = await _rpc(client, "not-a-token", "ping")
    assert bad.status_code == 401


async def test_full_flow_then_tools(client, seeded) -> None:
    tokens = await _connect(client)
    access = tokens["access_token"]

    init = await _rpc(client, access, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
    assert init.status_code == 200
    assert init.json()["result"]["protocolVersion"] == "2025-06-18"
    assert init.json()["result"]["capabilities"] == {"tools": {"listChanged": False}}

    note = await client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert note.status_code == 202

    listed = (await _rpc(client, access, "tools/list")).json()["result"]["tools"]
    names = {t["name"] for t in listed}
    assert {"list_folders", "read_note", "get_test", "get_learning_module"} <= names
    assert all(t["inputSchema"]["type"] == "object" for t in listed)

    folders = (await _rpc(client, access, "tools/call", {"name": "list_folders", "arguments": {}})).json()
    payload = folders["result"]["structuredContent"]
    assert [f["name"] for f in payload["folders"]] == ["Chemistry"]

    notes = (
        await _rpc(client, access, "tools/call", {"name": "list_folder_notes", "arguments": {"folder_id": seeded["folder_id"]}})
    ).json()["result"]["structuredContent"]["notes"]
    assert notes[0]["total_chars"] == 100
    note_id = notes[0]["note_id"]

    page = (
        await _rpc(client, access, "tools/call", {"name": "read_note", "arguments": {"note_id": note_id, "max_chars": 60}})
    ).json()["result"]["structuredContent"]
    assert page["content"] == "A" * 50 + "B" * 10 and page["next_offset"] == 60

    # Another user's folder is invisible, reported as a tool error the model can read.
    foreign = (
        await _rpc(client, access, "tools/call", {"name": "list_tests", "arguments": {"folder_id": seeded["foreign_id"]}})
    ).json()["result"]
    assert foreign["isError"] is True and "not found" in foreign["structuredContent"]["error"]

    # Bad arguments are a tool error too, not a protocol error.
    bad_args = (
        await _rpc(client, access, "tools/call", {"name": "read_note", "arguments": {"note_id": "x", "nope": 1}})
    ).json()["result"]
    assert bad_args["isError"] is True

    unknown = (await _rpc(client, access, "tools/call", {"name": "drop_tables"})).json()
    assert unknown["error"]["code"] == -32602


async def test_refresh_rotates_and_revoke_kills(client) -> None:
    tokens = await _connect(client)
    refreshed = await client.post(
        "/oauth/token",
        data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": tokens["client_id"]},
    )
    assert refreshed.status_code == 200
    new = refreshed.json()

    # The old pair is dead after rotation.
    assert (await _rpc(client, tokens["access_token"], "ping")).status_code == 401
    reuse = await client.post(
        "/oauth/token",
        data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": tokens["client_id"]},
    )
    assert reuse.status_code == 400

    assert (await _rpc(client, new["access_token"], "ping")).status_code == 200
    await client.post("/oauth/revoke", data={"token": new["refresh_token"]})
    assert (await _rpc(client, new["access_token"], "ping")).status_code == 401


async def test_pkce_mismatch_rejected(client) -> None:
    reg = (await client.post("/oauth/register", json={"redirect_uris": [REDIRECT]})).json()
    _, challenge = _pkce()
    auth = await client.get(
        "/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": reg["client_id"],
            "redirect_uri": REDIRECT,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    request_id = parse_qs(urlsplit(auth.headers["location"]).query)["request"][0]
    code = parse_qs(urlsplit((await client.post(f"/oauth/requests/{request_id}/approve")).json()["redirect_url"]).query)[
        "code"
    ][0]
    tok = await client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": reg["client_id"],
            "code_verifier": secrets.token_urlsafe(48),
        },
    )
    assert tok.status_code == 400 and tok.json()["error"] == "invalid_grant"


async def test_authorize_never_redirects_to_unregistered_uri(client) -> None:
    reg = (await client.post("/oauth/register", json={"redirect_uris": [REDIRECT]})).json()
    resp = await client.get(
        "/oauth/authorize",
        params={"response_type": "code", "client_id": reg["client_id"], "redirect_uri": "https://evil.example/cb"},
    )
    assert resp.status_code == 400
    assert "location" not in resp.headers


async def test_authorize_errors_are_shown_not_redirected(client) -> None:
    # Anyone can register any https redirect URI, so a malformed request must
    # not bounce the browser to it: that would be an open redirect on Nosey.
    reg = (await client.post("/oauth/register", json={"redirect_uris": ["https://evil.example/phish"]})).json()
    resp = await client.get(
        "/oauth/authorize",
        params={"response_type": "token", "client_id": reg["client_id"], "redirect_uri": "https://evil.example/phish"},
    )
    assert resp.status_code == 400
    assert "location" not in resp.headers
    assert resp.json()["error"] == "unsupported_response_type"

    missing_pkce = await client.get(
        "/oauth/authorize",
        params={"response_type": "code", "client_id": reg["client_id"], "redirect_uri": "https://evil.example/phish"},
    )
    assert missing_pkce.status_code == 400 and "location" not in missing_pkce.headers


async def test_deny_returns_access_denied(client) -> None:
    reg = (await client.post("/oauth/register", json={"redirect_uris": [REDIRECT]})).json()
    _, challenge = _pkce()
    auth = await client.get(
        "/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": reg["client_id"],
            "redirect_uri": REDIRECT,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    request_id = parse_qs(urlsplit(auth.headers["location"]).query)["request"][0]
    denied = await client.post(f"/oauth/requests/{request_id}/deny")
    assert parse_qs(urlsplit(denied.json()["redirect_url"]).query)["error"] == ["access_denied"]
    # The request is gone after a decision.
    assert (await client.post(f"/oauth/requests/{request_id}/approve")).status_code == 404


async def test_non_beta_user_is_refused(client, db_session_maker) -> None:
    tokens = await _connect(client)
    async with db_session_maker() as session:
        user = await session.get(User, client.state["user"].id)
        user.is_beta = False
        await session.commit()
    resp = await _rpc(client, tokens["access_token"], "ping")
    assert resp.status_code == 403


@pytest.mark.parametrize(
    "uri",
    ["javascript:alert(1)", "data:text/html,x", "http://evil.example/cb", "https://claude.ai/cb#frag", ""],
)
async def test_redirect_uri_rejects_dangerous_values(uri) -> None:
    with pytest.raises(OAuthError):
        validate_redirect_uri(uri)


@pytest.mark.parametrize(
    "uri", ["https://chatgpt.com/connector_platform_oauth_redirect", "http://localhost:33418/callback", "cursor://anysphere.cursor-retrieval/oauth/callback"]
)
async def test_redirect_uri_accepts_real_clients(uri) -> None:
    validate_redirect_uri(uri)


async def test_read_tools_for_tests_cards_and_modules(client, seeded, db_session_maker) -> None:
    import json as _json

    from src.models.flashcard import Flashcard
    from src.models.learning_module import LearningModule, LearningTrack
    from src.models.mcq_option import MCQOption
    from src.models.question import Question
    from src.models.test import Test as TestRow

    async with db_session_maker() as session:
        test = TestRow(folder_id=seeded["folder_id"], title="Unit 1", test_type="MCQ_only", is_math_mode=True)
        session.add(test)
        await session.flush()
        question = Question(test_id=test.id, question_text="2+2?", question_type="MCQ", display_order=0)
        session.add(question)
        await session.flush()
        session.add_all(
            [
                MCQOption(question_id=question.id, option_text="4", is_correct=True, display_order=0),
                MCQOption(question_id=question.id, option_text="5", is_correct=False, display_order=1),
            ]
        )
        session.add(Flashcard(folder_id=seeded["folder_id"], front="H", back="Hydrogen"))
        track = LearningTrack(folder_id=seeded["folder_id"], status="ready", format="article", is_archived=False)
        session.add(track)
        await session.flush()
        module = LearningModule(
            track_id=track.id,
            order_index=0,
            title="Atoms",
            lesson_content="# Atoms",
            quiz_json=_json.dumps([{"question": "Q", "options": ["a", "b"], "correct_index": 1}]),
        )
        session.add(module)
        await session.commit()
        test_id, module_id = test.id, module.id

    access = (await _connect(client))["access_token"]

    async def call(name: str, arguments: dict) -> dict:
        result = (await _rpc(client, access, "tools/call", {"name": name, "arguments": arguments})).json()["result"]
        assert result["isError"] is False, result
        return result["structuredContent"]

    tests = await call("list_tests", {"folder_id": seeded["folder_id"]})
    assert tests["tests"][0]["question_count"] == 1

    full = await call("get_test", {"test_id": test_id})
    assert full["mode"] == "stem"
    assert [o["is_correct"] for o in full["questions"][0]["options"]] == [True, False]

    cards = await call("list_flashcards", {"folder_id": seeded["folder_id"]})
    assert cards["flashcards"][0]["back"] == "Hydrogen"

    tracks = await call("list_learning_tracks", {"folder_id": seeded["folder_id"]})
    assert tracks["tracks"][0]["modules"][0]["title"] == "Atoms"

    lesson = await call("get_learning_module", {"module_id": module_id})
    assert lesson["lesson_markdown"] == "# Atoms" and lesson["quiz"][0]["correct_index"] == 1


async def _approved_code(client: AsyncClient, redirect: str = REDIRECT) -> tuple[str, str, str]:
    """Register + authorize + approve. Returns (client_id, code, verifier)."""
    client_id = (await client.post("/oauth/register", json={"redirect_uris": [redirect]})).json()["client_id"]
    verifier, challenge = _pkce()
    auth = await client.get(
        "/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    request_id = parse_qs(urlsplit(auth.headers["location"]).query)["request"][0]
    url = (await client.post(f"/oauth/requests/{request_id}/approve")).json()["redirect_url"]
    return client_id, parse_qs(urlsplit(url).query)["code"][0], verifier


async def test_code_redeemed_concurrently_mints_one_token_pair(client) -> None:
    import asyncio

    client_id, code, verifier = await _approved_code(client)
    form = {"grant_type": "authorization_code", "code": code, "client_id": client_id, "code_verifier": verifier}
    results = await asyncio.gather(*(client.post("/oauth/token", data=form) for _ in range(4)))
    assert sorted(r.status_code for r in results) == [200, 400, 400, 400]


async def test_refresh_used_concurrently_rotates_once(client) -> None:
    import asyncio

    tokens = await _connect(client)
    form = {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": tokens["client_id"]}
    results = await asyncio.gather(*(client.post("/oauth/token", data=form) for _ in range(4)))
    assert sorted(r.status_code for r in results) == [200, 400, 400, 400]
    winner = next(r for r in results if r.status_code == 200).json()
    assert (await _rpc(client, winner["access_token"], "ping")).status_code == 200


@pytest.mark.parametrize(
    "redirect,trust",
    [
        ("https://claude.ai/api/mcp/auth_callback", "verified"),
        ("https://chatgpt.com/connector_platform_oauth_redirect", "verified"),
        ("http://localhost:33418/callback", "local"),
        ("https://claude.ai.evil.example/cb", "unverified"),
        ("cursor://anysphere.cursor-retrieval/oauth/callback", "unverified"),
    ],
)
async def test_consent_trust_comes_from_redirect_host_not_name(client, redirect, trust) -> None:
    # A phisher can name its client "Claude"; only the redirect host decides trust.
    client_id = (
        await client.post("/oauth/register", json={"client_name": "Claude", "redirect_uris": [redirect]})
    ).json()["client_id"]
    _, challenge = _pkce()
    auth = await client.get(
        "/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    request_id = parse_qs(urlsplit(auth.headers["location"]).query)["request"][0]
    assert (await client.get(f"/oauth/requests/{request_id}")).json()["trust"] == trust


async def test_client_name_control_characters_stripped(client) -> None:
    name = "Cla" + chr(7) + "ude" + chr(0)
    reg = await client.post("/oauth/register", json={"client_name": name, "redirect_uris": [REDIRECT]})
    assert reg.json()["client_name"] == "Claude"
