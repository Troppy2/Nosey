"""OAuth 2.1 endpoints for the Nosey MCP connector, plus discovery metadata.

The AI app talks to /.well-known/*, /oauth/register, /oauth/authorize,
/oauth/token and /oauth/revoke. The Nosey frontend's consent page talks to
/oauth/requests/{id} with the user's normal Nosey session.
"""
import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_session
from src.dependencies import get_beta_user, get_current_user
from src.limiter import limiter
from src.models.user import User
from src.services.mcp_oauth_service import (
    MCP_SCOPE,
    AuthorizeParams,
    McpOAuthService,
    OAuthError,
    describe_redirect,
    redirect_trust,
)

router = APIRouter(tags=["mcp-oauth"])

_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def public_base_url(request: Request) -> str:
    if settings.mcp_issuer_url:
        return settings.mcp_issuer_url.rstrip("/")
    # Render terminates TLS and uvicorn does not trust its forwarded headers,
    # so request.base_url says http. Honour X-Forwarded-Proto here: a spoofed
    # value only changes the metadata the spoofing caller gets back.
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    return f"{scheme}://{request.url.netloc}"


def client_key(request: Request) -> str:
    """Rate-limit key for calls made by AI apps' servers, not the user's browser.

    claude.ai and ChatGPT call from shared egress IPs, so a per-IP limit would
    be one bucket for every Nosey user connecting through them. Key by the
    bearer token instead (hashed, never stored), falling back to the address.
    """
    authorization = request.headers.get("authorization", "")
    if authorization:
        return "tok:" + hashlib.sha256(authorization.encode("utf-8")).hexdigest()[:32]
    return get_remote_address(request)


def mcp_resource_url(request: Request) -> str:
    return f"{public_base_url(request)}/mcp"


def _oauth_error_response(exc: OAuthError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "error_description": exc.description},
        headers=_NO_STORE,
    )


# ---------------------------------------------------------------- discovery

def _protected_resource_metadata(request: Request) -> dict[str, object]:
    base = public_base_url(request)
    return {
        "resource": f"{base}/mcp",
        "authorization_servers": [base],
        "scopes_supported": [MCP_SCOPE],
        "bearer_methods_supported": ["header"],
        "resource_name": "Nosey",
    }


@router.get("/.well-known/oauth-protected-resource")
async def protected_resource_metadata(request: Request) -> dict[str, object]:
    return _protected_resource_metadata(request)


@router.get("/.well-known/oauth-protected-resource/mcp")
async def protected_resource_metadata_mcp(request: Request) -> dict[str, object]:
    return _protected_resource_metadata(request)


def _authorization_server_metadata(request: Request) -> dict[str, object]:
    base = public_base_url(request)
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "revocation_endpoint": f"{base}/oauth/revoke",
        "scopes_supported": [MCP_SCOPE],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
    }


@router.get("/.well-known/oauth-authorization-server")
async def authorization_server_metadata(request: Request) -> dict[str, object]:
    return _authorization_server_metadata(request)


# Some clients only try the OpenID path; serve the same document there.
@router.get("/.well-known/openid-configuration")
async def openid_configuration(request: Request) -> dict[str, object]:
    return _authorization_server_metadata(request)


# ---------------------------------------------------------------- registration

class ClientRegistration(BaseModel):
    redirect_uris: list[str] = Field(default_factory=list)
    client_name: Optional[str] = None
    token_endpoint_auth_method: Optional[str] = None


@router.post("/oauth/register", status_code=201)
@limiter.limit("60/minute")
async def register_client(
    request: Request,
    data: ClientRegistration,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    if data.token_endpoint_auth_method not in (None, "none"):
        return _oauth_error_response(
            OAuthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method=none) are supported.")
        )
    try:
        client = await McpOAuthService().register_client(session, data.client_name, data.redirect_uris)
    except OAuthError as exc:
        return _oauth_error_response(exc)
    return JSONResponse(
        status_code=201,
        content={
            "client_id": client.client_id,
            "client_id_issued_at": int(client.created_at.replace(tzinfo=timezone.utc).timestamp()),
            "client_name": client.client_name,
            "redirect_uris": json.loads(client.redirect_uris),
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "scope": MCP_SCOPE,
        },
        headers=_NO_STORE,
    )


# ---------------------------------------------------------------- authorize

@router.get("/oauth/authorize")
@limiter.limit("30/minute")
async def authorize(
    request: Request,
    response_type: Optional[str] = None,
    client_id: Optional[str] = None,
    redirect_uri: Optional[str] = None,
    code_challenge: Optional[str] = None,
    code_challenge_method: Optional[str] = None,
    state: Optional[str] = None,
    scope: Optional[str] = None,
    resource: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    # Errors are shown here, never redirected. Anyone can register a client
    # (DCR) with any https redirect URI, so bouncing a malformed request
    # straight back to it would make this endpoint an open redirector on
    # Nosey's domain (RFC 9700 4.11.2). The only redirects to a client URI are
    # approve/deny, after the user saw the destination host and clicked.
    service = McpOAuthService()
    try:
        await service.check_client_redirect(session, client_id, redirect_uri)
    except OAuthError as exc:
        return _oauth_error_response(exc)

    params = AuthorizeParams(
        response_type=response_type,
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        state=state,
        scope=scope,
        resource=resource,
    )
    try:
        request_id = await service.start_authorization(session, params)
    except OAuthError as exc:
        return _oauth_error_response(exc)
    consent_url = f"{settings.frontend_url.rstrip('/')}/connect/authorize?request={request_id}"
    return RedirectResponse(consent_url, status_code=302)


# ---------------------------------------------------------------- consent page API

class ConsentRequestResponse(BaseModel):
    request_id: str
    # Self-declared by whoever registered the client; never proof of identity.
    client_name: str
    redirect_host: str
    # "verified" | "local" | "unverified": see redirect_trust.
    trust: str


class ConsentDecisionResponse(BaseModel):
    redirect_url: str


@router.get("/oauth/requests/{request_id}", response_model=ConsentRequestResponse)
async def get_consent_request(
    request_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
):
    try:
        req, client = await McpOAuthService().get_pending(session, request_id)
    except OAuthError as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.description})
    return ConsentRequestResponse(
        request_id=req.request_id,
        client_name=client.client_name,
        redirect_host=describe_redirect(req.redirect_uri),
        trust=redirect_trust(req.redirect_uri),
    )


@router.post("/oauth/requests/{request_id}/approve", response_model=ConsentDecisionResponse)
async def approve_consent_request(
    request_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
):
    try:
        url = await McpOAuthService().approve(session, request_id, user)
    except OAuthError as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.description})
    return ConsentDecisionResponse(redirect_url=url)


@router.post("/oauth/requests/{request_id}/deny", response_model=ConsentDecisionResponse)
async def deny_consent_request(
    request_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
):
    try:
        url = await McpOAuthService().deny(session, request_id)
    except OAuthError as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.description})
    return ConsentDecisionResponse(redirect_url=url)


# ---------------------------------------------------------------- token + revoke

@router.post("/oauth/token")
@limiter.limit("300/minute")
async def token(
    request: Request,
    grant_type: Optional[str] = Form(default=None),
    code: Optional[str] = Form(default=None),
    redirect_uri: Optional[str] = Form(default=None),
    client_id: Optional[str] = Form(default=None),
    code_verifier: Optional[str] = Form(default=None),
    refresh_token: Optional[str] = Form(default=None),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    service = McpOAuthService()
    try:
        if grant_type == "authorization_code":
            body = await service.exchange_code(session, code, client_id, redirect_uri, code_verifier)
        elif grant_type == "refresh_token":
            body = await service.refresh(session, refresh_token, client_id)
        else:
            raise OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.")
    except OAuthError as exc:
        return _oauth_error_response(exc)
    return JSONResponse(content=body, headers=_NO_STORE)


@router.post("/oauth/revoke")
@limiter.limit("300/minute")
async def revoke(
    request: Request,
    token: Optional[str] = Form(default=None),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    await McpOAuthService().revoke(session, token)
    return JSONResponse(content={}, headers=_NO_STORE)


# ---------------------------------------------------------------- Settings: connected apps

class ConnectionResponse(BaseModel):
    id: int
    client_name: str
    connected_at: datetime
    last_used_at: Optional[datetime] = None


@router.get("/oauth/connections", response_model=list[ConnectionResponse])
async def list_connections(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[ConnectionResponse]:
    rows = await McpOAuthService().list_connections(session, user.id)
    return [
        ConnectionResponse(
            id=token.id, client_name=name, connected_at=token.created_at, last_used_at=token.last_used_at
        )
        for token, name in rows
    ]


@router.delete("/oauth/connections/{connection_id}", status_code=204, response_model=None)
async def revoke_connection(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    # Not beta-gated: a user who lost beta must still be able to disconnect.
    if not await McpOAuthService().revoke_connection(session, user.id, connection_id):
        raise HTTPException(status_code=404, detail="Connection not found")
