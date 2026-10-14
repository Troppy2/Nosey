"""OAuth 2.1 authorization server for the Nosey MCP connector.

Flow (authorization code + PKCE, public clients only):
1. The AI app registers itself (POST /oauth/register) and gets a client_id.
2. It sends the user to GET /oauth/authorize. We store the request and send
   the browser to the consent page on the Nosey frontend.
3. The signed-in user approves there; we mint a single-use code and the page
   redirects back to the app's redirect_uri.
4. The app trades code + code_verifier for an access and refresh token.

Access tokens are opaque random strings, checked against a SHA-256 hash in
mcp_oauth_tokens on every /mcp call (the user row is loaded anyway, so a
revoke or a ban takes effect on the next call).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode, urlsplit

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.mcp_oauth import McpOAuthClient, McpOAuthRequest, McpOAuthToken
from src.models.user import User
from src.utils.time import utcnow_naive

MCP_SCOPE = "nosey"
AUTH_REQUEST_TTL = timedelta(minutes=10)
CODE_TTL = timedelta(minutes=5)
# Writing last_used_at on every tool call would be a DB write per call; the
# Settings page only needs it roughly.
LAST_USED_RESOLUTION = timedelta(minutes=5)

_MAX_REDIRECT_URIS = 10
_MAX_URI_LENGTH = 2000
_PKCE_VERIFIER = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
_CUSTOM_SCHEME = re.compile(r"^[a-z][a-z0-9+.\-]*$")
# Schemes a redirect may never use. The consent page navigates the browser to
# the redirect URI, so javascript:/data: here would run script on Nosey's origin.
_BLOCKED_SCHEMES = {"javascript", "data", "vbscript", "file", "about", "blob", "ftp", "ws", "wss"}
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


class OAuthError(Exception):
    """An OAuth protocol error, rendered as {"error", "error_description"}."""

    def __init__(self, error: str, description: str, status_code: int = 400) -> None:
        super().__init__(description)
        self.error = error
        self.description = description
        self.status_code = status_code


@dataclass(frozen=True)
class AuthorizeParams:
    response_type: Optional[str]
    client_id: Optional[str]
    redirect_uri: Optional[str]
    code_challenge: Optional[str]
    code_challenge_method: Optional[str]
    state: Optional[str]
    scope: Optional[str]
    resource: Optional[str]


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def validate_redirect_uri(uri: str) -> None:
    """https anywhere, http only on loopback, or a private-use app scheme."""
    if not uri or len(uri) > _MAX_URI_LENGTH:
        raise OAuthError("invalid_redirect_uri", "Redirect URI is missing or too long.")
    parts = urlsplit(uri)
    scheme = parts.scheme.lower()
    if parts.fragment:
        raise OAuthError("invalid_redirect_uri", "Redirect URI must not contain a fragment.")
    if scheme == "https":
        if not parts.hostname:
            raise OAuthError("invalid_redirect_uri", "Redirect URI needs a host.")
        return
    if scheme == "http":
        if parts.hostname in _LOOPBACK_HOSTS:
            return
        raise OAuthError("invalid_redirect_uri", "http redirect URIs are only allowed on localhost.")
    if scheme and _CUSTOM_SCHEME.match(scheme) and scheme not in _BLOCKED_SCHEMES:
        return
    raise OAuthError("invalid_redirect_uri", f"Redirect URI scheme '{scheme}' is not allowed.")


def redirect_with(redirect_uri: str, params: dict[str, Optional[str]]) -> str:
    query = urlencode({k: v for k, v in params.items() if v is not None})
    separator = "&" if "?" in redirect_uri else "?"
    return f"{redirect_uri}{separator}{query}"


def describe_redirect(redirect_uri: str) -> str:
    """What the consent page shows as the destination: the host, or the scheme."""
    parts = urlsplit(redirect_uri)
    return parts.hostname or f"{parts.scheme}:"


class McpOAuthService:
    async def register_client(
        self, session: AsyncSession, client_name: Optional[str], redirect_uris: list[str]
    ) -> McpOAuthClient:
        if not redirect_uris or len(redirect_uris) > _MAX_REDIRECT_URIS:
            raise OAuthError("invalid_redirect_uri", f"Provide 1 to {_MAX_REDIRECT_URIS} redirect URIs.")
        for uri in redirect_uris:
            validate_redirect_uri(uri)
        client = McpOAuthClient(
            client_id=f"nosey-{secrets.token_urlsafe(24)}",
            client_name=(client_name or "").strip()[:120] or "AI app",
            redirect_uris=json.dumps(redirect_uris),
        )
        session.add(client)
        await session.commit()
        await session.refresh(client)
        return client

    async def get_client(self, session: AsyncSession, client_id: Optional[str]) -> Optional[McpOAuthClient]:
        if not client_id:
            return None
        return await session.scalar(select(McpOAuthClient).where(McpOAuthClient.client_id == client_id))

    async def check_client_redirect(
        self, session: AsyncSession, client_id: Optional[str], redirect_uri: Optional[str]
    ) -> McpOAuthClient:
        """Errors here must NOT redirect: the redirect target itself is untrusted."""
        client = await self.get_client(session, client_id)
        if client is None:
            raise OAuthError("invalid_client", "Unknown client_id. Register the app again.")
        if not redirect_uri or redirect_uri not in json.loads(client.redirect_uris):
            raise OAuthError("invalid_request", "redirect_uri does not match a registered redirect URI.")
        return client

    async def start_authorization(self, session: AsyncSession, params: AuthorizeParams) -> str:
        """Store a pending request and return its public request_id.

        Callers must have passed check_client_redirect first. Raises OAuthError
        for a malformed request; the route renders it and does not redirect.
        """
        if params.response_type != "code":
            raise OAuthError("unsupported_response_type", "Only response_type=code is supported.")
        if params.code_challenge_method != "S256" or not params.code_challenge:
            raise OAuthError("invalid_request", "PKCE with code_challenge_method=S256 is required.")
        if len(params.code_challenge) > 128:
            raise OAuthError("invalid_request", "code_challenge is too long.")

        now = utcnow_naive()
        # Opportunistic cleanup: abandoned consent pages and redeemed codes.
        await session.execute(delete(McpOAuthRequest).where(McpOAuthRequest.expires_at < now - timedelta(days=1)))
        request_id = secrets.token_urlsafe(24)
        session.add(
            McpOAuthRequest(
                request_id=request_id,
                client_id=params.client_id,
                redirect_uri=params.redirect_uri,
                state=params.state,
                code_challenge=params.code_challenge,
                scope=MCP_SCOPE,
                resource=params.resource,
                expires_at=now + AUTH_REQUEST_TTL,
            )
        )
        await session.commit()
        return request_id

    async def get_pending(self, session: AsyncSession, request_id: str) -> tuple[McpOAuthRequest, McpOAuthClient]:
        req = await session.scalar(select(McpOAuthRequest).where(McpOAuthRequest.request_id == request_id))
        if req is None or req.code_hash is not None or req.expires_at < utcnow_naive():
            raise OAuthError(
                "invalid_request",
                "This connection request has expired or was already used. Start again from the AI app.",
                status_code=404,
            )
        client = await self.get_client(session, req.client_id)
        if client is None:
            raise OAuthError("invalid_client", "The app that started this request no longer exists.", 404)
        return req, client

    async def approve(self, session: AsyncSession, request_id: str, user: User) -> str:
        req, _ = await self.get_pending(session, request_id)
        code = secrets.token_urlsafe(32)
        req.user_id = user.id
        req.code_hash = hash_secret(code)
        req.expires_at = utcnow_naive() + CODE_TTL
        await session.commit()
        return redirect_with(req.redirect_uri, {"code": code, "state": req.state})

    async def deny(self, session: AsyncSession, request_id: str) -> str:
        req, _ = await self.get_pending(session, request_id)
        redirect_uri, state = req.redirect_uri, req.state
        await session.delete(req)
        await session.commit()
        return redirect_with(
            redirect_uri,
            {"error": "access_denied", "error_description": "The user declined.", "state": state},
        )

    async def exchange_code(
        self,
        session: AsyncSession,
        code: Optional[str],
        client_id: Optional[str],
        redirect_uri: Optional[str],
        code_verifier: Optional[str],
    ) -> dict[str, object]:
        if not code or not client_id or not code_verifier:
            raise OAuthError("invalid_request", "code, client_id and code_verifier are required.")
        if not _PKCE_VERIFIER.match(code_verifier):
            raise OAuthError("invalid_grant", "Malformed code_verifier.")
        req = await session.scalar(select(McpOAuthRequest).where(McpOAuthRequest.code_hash == hash_secret(code)))
        now = utcnow_naive()
        if req is None or req.used_at is not None or req.expires_at < now or req.user_id is None:
            raise OAuthError("invalid_grant", "The authorization code is invalid, expired or already used.")
        if req.client_id != client_id:
            raise OAuthError("invalid_grant", "The code was issued to a different client.")
        if redirect_uri is not None and redirect_uri != req.redirect_uri:
            raise OAuthError("invalid_grant", "redirect_uri does not match the authorization request.")
        if not hmac.compare_digest(_pkce_challenge(code_verifier), req.code_challenge):
            raise OAuthError("invalid_grant", "PKCE verification failed.")

        req.used_at = now
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        session.add(
            McpOAuthToken(
                user_id=req.user_id,
                client_id=client_id,
                scope=req.scope,
                access_hash=hash_secret(access),
                refresh_hash=hash_secret(refresh),
                access_expires_at=now + timedelta(seconds=settings.mcp_access_token_ttl_seconds),
                refresh_expires_at=now + timedelta(days=settings.mcp_refresh_token_ttl_days),
            )
        )
        await session.commit()
        return self._token_response(access, refresh, req.scope)

    async def refresh(
        self, session: AsyncSession, refresh_token: Optional[str], client_id: Optional[str]
    ) -> dict[str, object]:
        if not refresh_token or not client_id:
            raise OAuthError("invalid_request", "refresh_token and client_id are required.")
        token = await session.scalar(
            select(McpOAuthToken).where(McpOAuthToken.refresh_hash == hash_secret(refresh_token))
        )
        now = utcnow_naive()
        if (
            token is None
            or token.revoked_at is not None
            or token.refresh_expires_at < now
            or token.client_id != client_id
        ):
            raise OAuthError("invalid_grant", "The refresh token is invalid, expired or revoked.")
        # Rotate both in place: the old refresh token stops working now.
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        token.access_hash = hash_secret(access)
        token.refresh_hash = hash_secret(refresh)
        token.access_expires_at = now + timedelta(seconds=settings.mcp_access_token_ttl_seconds)
        token.refresh_expires_at = now + timedelta(days=settings.mcp_refresh_token_ttl_days)
        await session.commit()
        return self._token_response(access, refresh, token.scope)

    async def revoke(self, session: AsyncSession, raw_token: Optional[str]) -> None:
        """RFC 7009: revoking an unknown token is not an error."""
        if not raw_token:
            return
        hashed = hash_secret(raw_token)
        token = await session.scalar(
            select(McpOAuthToken).where(
                (McpOAuthToken.access_hash == hashed) | (McpOAuthToken.refresh_hash == hashed)
            )
        )
        if token is not None and token.revoked_at is None:
            token.revoked_at = utcnow_naive()
            await session.commit()

    async def authenticate(self, session: AsyncSession, raw_token: str) -> Optional[User]:
        """The user behind a live access token, or None. Ban checks are the caller's."""
        token = await session.scalar(
            select(McpOAuthToken).where(McpOAuthToken.access_hash == hash_secret(raw_token))
        )
        now = utcnow_naive()
        if token is None or token.revoked_at is not None or token.access_expires_at < now:
            return None
        user = await session.get(User, token.user_id)
        if user is None:
            return None
        if token.last_used_at is None or now - token.last_used_at > LAST_USED_RESOLUTION:
            token.last_used_at = now
            await session.commit()
        return user

    @staticmethod
    def _token_response(access: str, refresh: str, scope: str) -> dict[str, object]:
        return {
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": settings.mcp_access_token_ttl_seconds,
            "refresh_token": refresh,
            "scope": scope,
        }
