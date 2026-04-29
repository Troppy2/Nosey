from __future__ import annotations

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from src.config import settings
from src.database import get_session
from src.models.user import User
from src.repositories.user_repository import UserRepository
from src.services.auth_service import AuthService
from src.utils.exceptions import ValidationException


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    if authorization is None:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_repo = UserRepository(session)
    try:
        user_id = AuthService().verify_jwt(token)
        user = await user_repo.get_by_id(user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    except (jwt.InvalidTokenError, ValidationException):
        if settings.environment != "development":
            raise HTTPException(status_code=401, detail="Invalid token")

    user = await user_repo.create_or_update(
        google_id="development-user",
        email="dev@example.com",
        full_name="Development User",
        profile_picture_url=None,
    )
    await session.commit()
    return user
