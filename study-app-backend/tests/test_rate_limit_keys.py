"""Rate-limit keys: per account by default, per IP where accounts are made.

Keyed by IP, users sharing an address (campus wifi, or Render's proxy) share
one bucket, so one person could use up everyone's limit. Account-creating
routes must stay on the IP: keyed by the caller's token, guest #1's token
could mint guest #2 in a fresh bucket, and so on forever.
"""
from __future__ import annotations

from starlette.requests import Request

import src.main  # noqa: F401  (imports every router, registering its limits)
from src.limiter import ip_key, limiter, user_key
from src.services.auth_service import AuthService


def _request(headers: dict[str, str]) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "client": ("10.0.0.1", 1234)})


def test_default_key_is_the_account():
    assert limiter._key_func is user_key


def test_user_key_uses_verified_account_only():
    token = AuthService().generate_jwt(42)
    assert user_key(_request({"Authorization": f"Bearer {token}"})) == "user:42"
    # Forged or garbage tokens cannot choose a bucket.
    assert user_key(_request({"Authorization": "Bearer not-a-jwt"})) == "10.0.0.1"
    assert user_key(_request({})) == "10.0.0.1"


def test_account_creating_routes_stay_on_ip():
    for route in (
        "src.routes.auth.google_auth",
        "src.routes.auth.guest_auth",
        "src.routes.mcp_oauth.register_client",
        "src.routes.mcp_oauth.authorize",
        "src.routes.mcp_oauth.token",
        "src.routes.mcp_oauth.revoke",
    ):
        limits = limiter._route_limits[route]
        assert limits and all(lim.key_func is ip_key for lim in limits), route


def test_signed_in_routes_use_the_account():
    pinned = {name for name in limiter._route_limits if ".auth." in name or ".mcp_oauth." in name}
    pinned.add("src.routes.mcp.mcp_post")  # keyed by its own bearer token (client_key)
    others = {n: lims for n, lims in limiter._route_limits.items() if n not in pinned}
    assert len(others) > 30
    for name, limits in others.items():
        assert all(lim.key_func is user_key for lim in limits), name
