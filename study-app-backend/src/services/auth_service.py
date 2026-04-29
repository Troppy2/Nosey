from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.user import User
from src.repositories.user_repository import UserRepository
from src.schemas.auth_schema import AuthResponse, UserResponse
from src.utils.exceptions import ValidationException


class AuthService:
    async def verify_google_token(self, token: str) -> dict[str, str | None]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://oauth2.googleapis.com/tokeninfo", params={"id_token": token}
            )
            response.raise_for_status()
            payload = response.json()
        audience = payload.get("aud")
        if settings.google_client_id != "replace-me" and audience != settings.google_client_id:
            raise ValidationException("Google token audience does not match this app")
        return {
            "google_id": str(payload["sub"]),
            "email": str(payload["email"]),
            "full_name": payload.get("name"),
            "profile_picture_url": payload.get("picture"),
        }

    async def authenticate_google_token(self, token: str, session: AsyncSession) -> AuthResponse:
        google_user = await self.verify_google_token(token)
        user = await UserRepository(session).create_or_update(
            google_id=str(google_user["google_id"]),
            email=str(google_user["email"]),
            full_name=google_user["full_name"],
            profile_picture_url=google_user["profile_picture_url"],
        )
        await session.commit()
        return self._token_response(user)

    def generate_jwt(self, user_id: int) -> str:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiration_hours)
        return jwt.encode(
            {"user_id": user_id, "exp": expires_at},
            settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
        )

    def verify_jwt(self, token: str) -> int:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("user_id")
        if not user_id:
            raise ValidationException("Invalid token")
        return int(user_id)

    def _token_response(self, user: User) -> AuthResponse:
        return AuthResponse(
            user_id=user.id,
            access_token=self.generate_jwt(user.id),
            email=user.email,
            user=UserResponse.model_validate(user),
        )
