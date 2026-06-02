from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import func, select

from src.models.user import User
from src.repositories.base_repository import BaseRepository


class UserRepository(BaseRepository[User]):
    async def get_by_id(self, user_id: int) -> Optional[User]:
        return await self.session.scalar(select(User).where(User.id == user_id))

    async def get_by_google_id(self, google_id: str) -> Optional[User]:
        return await self.session.scalar(select(User).where(User.google_id == google_id))

    async def get_all_users(self) -> list[User]:
        result = await self.session.scalars(select(User).order_by(User.created_at.desc()))
        return list(result.all())

    async def count_users(self) -> int:
        result = await self.session.scalar(select(func.count()).select_from(User))
        return int(result or 0)

    async def create_guest_user(self) -> User:
        guest_id = str(uuid.uuid4())
        user = User(
            google_id=f"guest_{guest_id}",
            email=f"guest_{guest_id}@nosey.guest",
            full_name="Guest",
            profile_picture_url=None,
        )
        self.session.add(user)
        await self.session.flush()
        return user

    async def delete_user(self, user: User) -> None:
        await self.session.delete(user)

    async def create_or_update(
        self,
        google_id: str,
        email: str,
        full_name: Optional[str],
        profile_picture_url: Optional[str],
        email_verified: bool = False,
        is_admin: bool = False,
    ) -> User:
        user = await self.get_by_google_id(google_id)
        if user is None:
            user = User(
                google_id=google_id,
                email=email,
                full_name=full_name,
                profile_picture_url=profile_picture_url,
                email_verified=email_verified,
                is_admin=is_admin,
            )
            self.session.add(user)
        else:
            user.email = email
            user.full_name = full_name
            user.profile_picture_url = profile_picture_url
            user.email_verified = email_verified
            user.is_admin = is_admin
        await self.session.flush()
        return user
