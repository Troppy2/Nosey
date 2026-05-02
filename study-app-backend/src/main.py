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
                origins = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                origins = [o.strip() for o in raw.split(",") if o.strip()]
        else:
            origins = [o.strip() for o in raw.split(",") if o.strip()]
        return [o.rstrip("/") for o in origins]
    parsed = settings.cors_origins
    if isinstance(parsed, list):
        return [o.rstrip("/") for o in parsed]
    return ["https://nosey-eosin.vercel.app"]


app = FastAPI(title="Study App", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_cors_origins(),
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
