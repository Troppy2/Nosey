from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from sqlalchemy import extract, func, select

from src.models.user import User
from src.repositories.base_repository import BaseRepository


def _compute_age(dob: date) -> int:
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


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

    async def update_date_of_birth(self, user: User, dob: date) -> User:
        user.date_of_birth = dob
        user.age = _compute_age(dob)
        await self.session.flush()
        return user

    async def refresh_age_if_birthday(self, user: User) -> bool:
        """Recalculate age if today is the user's birthday. Returns True if updated."""
        if user.date_of_birth is None:
            return False
        new_age = _compute_age(user.date_of_birth)
        if user.age != new_age:
            user.age = new_age
            await self.session.flush()
            return True
        return False

    async def refresh_all_birthday_ages(self) -> int:
        """Update age for every user whose birthday is today. Returns count updated."""
        today = date.today()
        result = await self.session.scalars(
            select(User).where(
                User.date_of_birth.is_not(None),
                extract('month', User.date_of_birth) == today.month,
                extract('day', User.date_of_birth) == today.day,
            )
        )
        users = list(result.all())
        count = 0
        for u in users:
            new_age = _compute_age(u.date_of_birth)  # type: ignore[arg-type]  # filtered by is_not(None) above
            if u.age != new_age:
                u.age = new_age
                count += 1
        if count:
            await self.session.flush()
        return count
