import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.repositories.user_repository import UserRepository
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
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Could not reach Google authentication service") from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Google auth")
        raise HTTPException(status_code=500, detail="Authentication failed") from exc


@router.post("/guest", response_model=AuthResponse)
async def guest_auth(
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        user = await UserRepository(session).create_guest_user()
        await session.commit()
        return AuthService()._token_response(user)
    except Exception as exc:
        logger.exception("Unexpected error during guest auth")
        raise HTTPException(status_code=500, detail="Guest authentication failed") from exc


@router.delete("/account", status_code=204)
async def delete_account(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    try:
        await UserRepository(session).delete_user(current_user)
        await session.commit()
    except Exception as exc:
        logger.exception("Unexpected error during account deletion")
        raise HTTPException(status_code=500, detail="Account deletion failed") from exc
