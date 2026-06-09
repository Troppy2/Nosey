from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.user import User
from src.repositories.user_repository import UserRepository
from src.schemas.auth_schema import AdminTokenResponse, AuthResponse, UserResponse
from src.utils.exceptions import ValidationException
from typing import Optional

ADMIN_TOKEN_TTL_SECONDS = 300  # 5 minutes


class AuthService:
    async def verify_google_token(self, token: str) -> dict[str, Optional[str]]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://oauth2.googleapis.com/tokeninfo", params={"id_token": token}
            )
            response.raise_for_status()
            payload = response.json()
        audience = payload.get("aud")
        if audience != settings.google_client_id:
            raise ValidationException("Google token audience does not match this app")
        google_id = payload.get("sub")
        email = payload.get("email")
        if not google_id or not email:
            raise ValidationException("Google token is missing required fields")
        email_verified = payload.get("email_verified", "false").lower() == "true"
        return {
            "google_id": str(google_id),
            "email": str(email),
            "full_name": payload.get("name"),
            "profile_picture_url": payload.get("picture"),
            "email_verified": email_verified,
        }

    async def authenticate_google_token(self, token: str, session: AsyncSession) -> AuthResponse:
        google_user = await self.verify_google_token(token)
        is_admin = str(google_user["email"]).lower() == settings.admin_email.lower()
        repo = UserRepository(session)
        user = await repo.create_or_update(
            google_id=str(google_user["google_id"]),
            email=str(google_user["email"]),
            full_name=google_user["full_name"],
            profile_picture_url=google_user["profile_picture_url"],
            email_verified=bool(google_user.get("email_verified", False)),
            is_admin=is_admin,
        )
        await repo.refresh_age_if_birthday(user)
        await session.commit()
        return self._token_response(user)

    def generate_jwt(self, user_id: int) -> str:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiration_hours)
        return jwt.encode(
            {"user_id": user_id, "exp": expires_at},
            settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
        )

    def generate_admin_jwt(self, user_id: int, session_id: str) -> str:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ADMIN_TOKEN_TTL_SECONDS)
        return jwt.encode(
            {
                "user_id": user_id,
                "exp": expires_at,
                "admin_session_id": session_id,
                "is_admin": True,
            },
            settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
        )

    def verify_jwt(self, token: str) -> int:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("user_id")
        if not user_id:
            raise ValidationException("Invalid token")
        return int(user_id)

    def verify_admin_jwt(self, token: str) -> tuple[int, str]:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("user_id")
        session_id = payload.get("admin_session_id")
        is_admin = payload.get("is_admin", False)
        if not user_id or not session_id or not is_admin:
            raise ValidationException("Invalid admin token")
        return int(user_id), str(session_id)

    async def create_admin_session(self, user: User, session: AsyncSession) -> str:
        session_id = str(uuid.uuid4())
        user.admin_session_id = session_id
        await session.commit()
        return session_id

    def _token_response(self, user: User) -> AuthResponse:
        return AuthResponse(
            user_id=user.id,
            access_token=self.generate_jwt(user.id),
            email=user.email,
            user=UserResponse.model_validate(user),
        )
