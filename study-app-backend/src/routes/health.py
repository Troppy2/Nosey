from fastapi import APIRouter

from src.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    return {
        "status": "healthy",
        "cors_origins": settings.cors_origins,
        "environment": settings.environment,
    }
