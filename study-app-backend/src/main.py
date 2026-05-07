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

from src.config import settings
from src.routes import attempts, auth, flashcards, folder_files, folders, health, kojo, leetcode, tests

app = FastAPI(title="Study App", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(folders.router)
app.include_router(folder_files.router)
app.include_router(tests.router)
app.include_router(attempts.router)
app.include_router(flashcards.router)
app.include_router(kojo.router)
app.include_router(leetcode.router)
