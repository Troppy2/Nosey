"""Nosey MCP server: Streamable HTTP transport, stateless, JSON responses only.

Hand-rolled instead of the official `mcp` SDK because the SDK requires
Starlette 1.x, uvicorn 0.31+ and newer PyJWT/python-multipart, which FastAPI
0.104 cannot run on. The protocol surface we need is small: one POST
endpoint carrying JSON-RPC 2.0 (initialize, ping, tools/list, tools/call).

Stateless means no Mcp-Session-Id and no server-to-client SSE stream, so any
worker can serve any request. GET and DELETE answer 405, as the spec allows.

Origin is not checked: every request needs a bearer token sent explicitly in
a header (never a cookie), so a cross-site page has no ambient credentials
to abuse, which is what the spec's Origin check guards against.
"""
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.limiter import limiter
from src.routes.mcp_oauth import client_key, public_base_url
from src.services.account_safety_service import SUSPENDED_MESSAGE
from src.services.mcp_oauth_service import McpOAuthService
from src.services.mcp_tools import TOOLS, McpContext, call_tool
from src.utils.provider_policy import user_can_override_provider

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mcp"])

SUPPORTED_PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
SERVER_INFO = {"name": "nosey", "title": "Nosey", "version": "1.0.0"}
SERVER_INSTRUCTIONS = (
    "Nosey is the user's study app. Content is organized in folders; each folder holds "
    "uploaded notes, practice tests, flashcards and learning module tracks. Call "
    "list_folders first to find ids. Use read_note to ground new study material in what "
    "the user uploaded, and get_attempt_result to see what they got wrong. You write the "
    "content; create_test, create_flashcards and add_note save it. Folders can be created "
    "and renamed but never deleted. Only delete anything (confirm=true) when the user asked "
    "for it. Share the url create_test returns."
)

# JSON-RPC error codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602


def _rpc_result(msg_id: Any, result: dict[str, Any]) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": msg_id, "result": result})


def _rpc_error(msg_id: Any, code: int, message: str, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}},
        status_code=status_code,
    )


def _unauthorized(request: Request, description: str) -> JSONResponse:
    metadata_url = f"{public_base_url(request)}/.well-known/oauth-protected-resource/mcp"
    return JSONResponse(
        status_code=401,
        content={"error": "invalid_token", "error_description": description},
        headers={
            "WWW-Authenticate": (
                f'Bearer error="invalid_token", error_description="{description}", '
                f'resource_metadata="{metadata_url}"'
            )
        },
    )


def _forbidden(description: str) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={"error": "insufficient_scope", "error_description": description},
        # The description stays out of the header: it can hold quotes or
        # non-latin-1 text (SUSPENDED_MESSAGE), which a header cannot carry.
        headers={"WWW-Authenticate": 'Bearer error="insufficient_scope"'},
    )


def _negotiate_version(requested: Optional[str]) -> str:
    if requested in SUPPORTED_PROTOCOL_VERSIONS:
        return requested
    return SUPPORTED_PROTOCOL_VERSIONS[0]


@router.post("/mcp")
@limiter.limit("120/minute", key_func=client_key)
async def mcp_post(request: Request, session: AsyncSession = Depends(get_session)) -> Response:
    authorization = request.headers.get("authorization", "")
    raw_token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if not raw_token:
        return _unauthorized(request, "Sign in to Nosey to use this connector.")
    user = await McpOAuthService().authenticate(session, raw_token)
    if user is None:
        return _unauthorized(request, "The access token is invalid or expired.")
    if user.banned_at is not None:
        return _forbidden(SUSPENDED_MESSAGE)
    if not user_can_override_provider(user):
        return _forbidden("The Nosey connector is only available to beta users.")

    version_header = request.headers.get("mcp-protocol-version")
    if version_header and version_header not in SUPPORTED_PROTOCOL_VERSIONS:
        return _rpc_error(None, INVALID_REQUEST, f"Unsupported MCP-Protocol-Version {version_header}.", 400)

    try:
        message = json.loads(await request.body())
    except (ValueError, UnicodeDecodeError):
        return _rpc_error(None, PARSE_ERROR, "Body is not valid JSON.", 400)
    if isinstance(message, list):
        return _rpc_error(None, INVALID_REQUEST, "JSON-RPC batches are not supported.", 400)
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _rpc_error(None, INVALID_REQUEST, "Expected a JSON-RPC 2.0 message.", 400)

    method = message.get("method")
    # Notifications (no id) and client responses (no method) need no reply.
    if "id" not in message or method is None:
        return Response(status_code=202)
    msg_id = message["id"]
    params = message.get("params") or {}
    if not isinstance(params, dict):
        return _rpc_error(msg_id, INVALID_PARAMS, "params must be an object.")

    if method == "initialize":
        return _rpc_result(
            msg_id,
            {
                "protocolVersion": _negotiate_version(params.get("protocolVersion")),
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
                "instructions": SERVER_INSTRUCTIONS,
            },
        )
    if method == "ping":
        return _rpc_result(msg_id, {})
    if method == "tools/list":
        return _rpc_result(msg_id, {"tools": [tool.describe() for tool in TOOLS.values()]})
    if method == "tools/call":
        name = params.get("name")
        if not isinstance(name, str) or name not in TOOLS:
            return _rpc_error(msg_id, INVALID_PARAMS, f"Unknown tool: {name}")
        # Read before the call: a failed tool rolls the session back, which
        # expires the loaded user, and touching user.id after that would lazy
        # load outside the async context.
        user_id = user.id
        payload, is_error = await call_tool(McpContext(user=user, session=session), name, params.get("arguments"))
        if is_error:
            logger.info("MCP tool %s failed for user %s: %s", name, user_id, payload.get("error"))
        return _rpc_result(
            msg_id,
            {
                # Text only, compact separators. Also sending structuredContent
                # makes some clients pass the payload to the model twice.
                "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))}],
                "isError": is_error,
            },
        )
    return _rpc_error(msg_id, METHOD_NOT_FOUND, f"Method not found: {method}")


@router.get("/mcp")
async def mcp_get() -> Response:
    # No server-initiated SSE stream: this server is stateless.
    return Response(status_code=405, headers={"Allow": "POST"})


@router.delete("/mcp")
async def mcp_delete() -> Response:
    # No sessions to terminate.
    return Response(status_code=405, headers={"Allow": "POST"})
