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
        is_admin = str(google_user["email"]).lower() in settings.admin_emails
        repo = UserRepository(session)
        is_new = await self._check_account_allowed(session, repo, str(google_user["google_id"]))
        user = await repo.create_or_update(
            google_id=str(google_user["google_id"]),
            email=str(google_user["email"]),
            full_name=google_user["full_name"],
            profile_picture_url=google_user["profile_picture_url"],
            email_verified=bool(google_user.get("email_verified", False)),
            is_admin=is_admin,
        )
        await repo.refresh_age_if_birthday(user)
        if is_new:
            # Flags a deleted account left behind follow the same Google
            # account to its new row, so deleting can't reset the history.
            from src.services.account_safety_service import relink_flags

            await relink_flags(session, user)
        await session.commit()
        return self._token_response(user)

    @staticmethod
    async def _check_account_allowed(session: AsyncSession, repo: UserRepository, google_id: str) -> bool:
        """Refuse a banned account, or a NEW account inside the deletion cooldown.

        GH #172/#173. An existing, unbanned user is never affected by a
        tombstone: tombstones only stop a row from being created. Returns True
        when this sign-in will create a new account.
        """
        from src.services.account_safety_service import SUSPENDED_MESSAGE, active_tombstone
        from src.utils.exceptions import ForbiddenException

        existing = await repo.get_by_google_id(google_id)
        if existing is not None:
            if existing.banned_at is not None:
                raise ForbiddenException(SUSPENDED_MESSAGE)
            return False
        tombstone = await active_tombstone(session, google_id)
        if tombstone is None:
            return True
        if tombstone.reason == "banned":
            raise ForbiddenException(SUSPENDED_MESSAGE)
        until = tombstone.expires_at.strftime("%b %d, %H:%M UTC") if tombstone.expires_at else "later"
        raise ForbiddenException(
            f"This Google account was deleted recently. You can sign up again after {until}."
        )

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
