import json
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.routes import attempts, auth, flashcards, folder_files, folders, health, kojo, tests


def _resolve_cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if raw:
        if raw.startswith("["):
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                pass
        return [o.strip() for o in raw.split(",") if o.strip()]
    parsed = settings.cors_origins
    if isinstance(parsed, list):
        return parsed
    return ["http://localhost:3000", "http://localhost:5173"]


app = FastAPI(title="Study App", version="0.1.0")

# For local development it's sometimes helpful to allow all origins to avoid
# intermittent CORS issues while debugging frontend/backend connectivity.
# This is intentionally permissive and should NOT be used in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev-only: allow any origin
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
