from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, computed_field


class GoogleAuthRequest(BaseModel):
    token: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: Optional[str] = None
    profile_picture_url: Optional[str] = None

    @computed_field
    @property
    def is_guest(self) -> bool:
        return self.email.endswith("@nosey.guest")


class AuthResponse(BaseModel):
    user_id: int
    access_token: str
    email: str
    user: UserResponse
