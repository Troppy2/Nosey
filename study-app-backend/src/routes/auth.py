import logging
from datetime import date

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.repositories.user_repository import UserRepository
from src.schemas.auth_schema import AuthResponse, DateOfBirthRequest, GoogleAuthRequest, UserResponse
from src.services.auth_service import AuthService
from src.limiter import limiter
from src.utils.exceptions import StudyAppException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/google", response_model=AuthResponse)
@limiter.limit("10/minute")
async def google_auth(
    request: Request,
    response: Response,
    body: GoogleAuthRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        return await AuthService().authenticate_google_token(body.token, session)
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
@limiter.limit("5/minute")
async def guest_auth(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    try:
        user = await UserRepository(session).create_guest_user()
        await session.commit()
        return AuthService()._token_response(user)
    except Exception as exc:
        logger.exception("Unexpected error during guest auth")
        raise HTTPException(status_code=500, detail="Guest authentication failed") from exc


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.post("/date-of-birth", response_model=UserResponse)
async def set_date_of_birth(
    request: DateOfBirthRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    today = date.today()
    min_dob = date(today.year - 120, today.month, today.day)
    max_dob = date(today.year - 5, today.month, today.day)
    if request.date_of_birth < min_dob or request.date_of_birth > max_dob:
        raise HTTPException(status_code=400, detail="Date of birth is not valid")
    try:
        user = await UserRepository(session).update_date_of_birth(current_user, request.date_of_birth)
        await session.commit()
        return UserResponse.model_validate(user)
    except Exception as exc:
        logger.exception("Unexpected error setting date of birth")
        raise HTTPException(status_code=500, detail="Failed to save date of birth") from exc


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
