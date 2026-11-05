from typing import Optional

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def _token_user_id(request: Request) -> Optional[int]:
    """The user id in a valid Nosey JWT on this request, or None."""
    authorization = request.headers.get("authorization", "")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    # Imported lazily: auth_service pulls in the DB layer.
    from src.services.auth_service import AuthService

    try:
        return AuthService().verify_jwt(token)
    except Exception:  # invalid/expired JWT, or a non-Nosey bearer token
        return None


def user_key(request: Request) -> str:
    """Default rate-limit key: the signed-in account, not the IP.

    SECURITY: keyed by IP, users who share an address share a bucket, so one
    person on campus wifi (or every user, if the address seen is Render's
    proxy) can use up everyone else's limit. A VPN or hotspot also resets an
    IP key. The JWT signature is verified here, so a forged or random token
    cannot pick its own bucket; it falls back to the address and the route's
    auth dependency rejects it anyway. Signing in again mints a new token for
    the SAME user id, so it does not reset the limit.

    slowapi runs the check after FastAPI resolves dependencies, so a request
    with a bad token is refused (401) before it touches any bucket.
    """
    user_id = _token_user_id(request)
    if user_id is not None:
        return f"user:{user_id}"
    return get_remote_address(request)


# Use on routes that create accounts or tokens (sign-in, guest sign-up, MCP
# OAuth). SECURITY: never key those by the caller's token: a guest token could
# then be used to mint the next guest in a fresh bucket, forever.
ip_key = get_remote_address

limiter = Limiter(key_func=user_key, headers_enabled=True)
