"""The X-Nosey-Safety response header (GH #173).

Moderation can decide, deep inside a route, that the reply should carry a
notice the frontend shows as a modal: "self-harm" (support resources, the
request still succeeds), "warning" (request refused), "suspended" (account
banned). Refusals set the header on their HTTPException directly. A notice on
a SUCCESSFUL response has no exception to ride on, so the route records it
here and SafetyNoticeMiddleware adds the header when the response starts.

The ContextVar holds a mutable dict set by the middleware: the endpoint may run
in a copied context (threadpool dependencies, task groups), and a copy still
points at the same dict, so a write from the endpoint is visible here.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

from starlette.types import ASGIApp, Message, Receive, Scope, Send

SAFETY_HEADER = "X-Nosey-Safety"

_notice: ContextVar[Optional[dict[str, str]]] = ContextVar("nosey_safety_notice", default=None)


def set_safety_notice(kind: str) -> None:
    """Attach a notice to the response of the current request, if any."""
    holder = _notice.get()
    if holder is not None:
        holder["kind"] = kind


class SafetyNoticeMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        holder: dict[str, str] = {}
        token = _notice.set(holder)

        async def send_with_notice(message: Message) -> None:
            if message["type"] == "http.response.start" and holder.get("kind"):
                headers = list(message.get("headers", []))
                # An exception's own header wins; never send two.
                if not any(k.lower() == SAFETY_HEADER.lower().encode() for k, _ in headers):
                    headers.append((SAFETY_HEADER.encode(), holder["kind"].encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_notice)
        finally:
            _notice.reset(token)
