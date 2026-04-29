from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.routes import attempts, auth, flashcards, folders, health, kojo, tests


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
app.include_router(tests.router)
app.include_router(attempts.router)
app.include_router(flashcards.router)
app.include_router(kojo.router)
