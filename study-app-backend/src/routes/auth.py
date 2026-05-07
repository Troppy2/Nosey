import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.schemas.auth_schema import AuthResponse, GoogleAuthRequest
from src.services.auth_service import AuthService
from src.utils.exceptions import StudyAppException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/google", response_model=AuthResponse)
async def google_auth(
    request: GoogleAuthRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        return await AuthService().authenticate_google_token(request.token, session)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google token") from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Google auth")
        raise HTTPException(status_code=500, detail="Authentication failed") from exc
