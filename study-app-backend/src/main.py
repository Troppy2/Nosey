import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


import socket as _socket

_orig_getaddrinfo = _socket.getaddrinfo

def _prefer_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    results = _orig_getaddrinfo(host, port, family, type, proto, flags)
    ipv4 = [r for r in results if r[0] == _socket.AF_INET]
    ipv6 = [r for r in results if r[0] != _socket.AF_INET]
    return ipv4 + ipv6

_socket.getaddrinfo = _prefer_ipv4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from src.config import settings
from src.limiter import limiter
from src.routes import admin, attempts, auth, flashcards, folder_files, folders, health, kojo, learning_modules, leetcode, mock_interview, slash_commands, surveys, tests
from src.utils.validators import MAX_UPLOAD_TOTAL_SIZE_BYTES

_MAX_REQUEST_BODY_BYTES = MAX_UPLOAD_TOTAL_SIZE_BYTES


class ContentSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length exceeds the upload cap before reading the body.

    Browsers always send Content-Length for multipart file uploads, so this
    prevents large PDFs from being buffered into memory and crashing the server.
    Returns 413 with a JSON detail field so the frontend error display works.
    """

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except ValueError:
                declared_size = 0
            if declared_size > _MAX_REQUEST_BODY_BYTES:
                limit_mb = _MAX_REQUEST_BODY_BYTES // (1024 * 1024)
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"Upload too large. Maximum total size is {limit_mb} MB."},
                )
        return await call_next(request)


app = FastAPI(title="Study App", version="0.1.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ContentSizeLimitMiddleware is added first so that CORSMiddleware (added second)
# becomes the outermost wrapper. This ensures 413 responses include CORS headers
# and the frontend error handler can read the "detail" field.
app.add_middleware(ContentSizeLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(folders.router)
app.include_router(folder_files.router)
app.include_router(tests.router)
app.include_router(attempts.router)
app.include_router(flashcards.router)
app.include_router(kojo.router)
app.include_router(leetcode.router)
app.include_router(mock_interview.router)
app.include_router(slash_commands.router)
app.include_router(surveys.router)
app.include_router(learning_modules.router)
