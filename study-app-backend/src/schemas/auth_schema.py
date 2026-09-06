from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field


class GoogleAuthRequest(BaseModel):
    token: str


class DateOfBirthRequest(BaseModel):
    date_of_birth: date


class PreferredNameRequest(BaseModel):
    # None or blank clears the preference and falls display back to full_name.
    preferred_name: Optional[str] = Field(default=None, max_length=60)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: Optional[str] = None
    preferred_name: Optional[str] = None
    profile_picture_url: Optional[str] = None
    is_admin: bool = False
    is_beta: bool = False
    email_verified: bool = False
    date_of_birth: Optional[date] = None
    age: Optional[int] = None
    onboarding_completed_at: Optional[datetime] = None

    @computed_field
    @property
    def display_name(self) -> str:
        """The one name the UI should show. Computed here so the greeting, the
        settings header and the mock interviewer cannot drift apart."""
        for candidate in (self.preferred_name, self.full_name):
            if candidate and candidate.strip():
                return candidate.strip()
        local = self.email.split("@")[0].strip()
        return local[:1].upper() + local[1:] if local else "there"

    @computed_field
    @property
    def onboarding_completed(self) -> bool:
        return self.onboarding_completed_at is not None

    @computed_field
    @property
    def is_guest(self) -> bool:
        return self.email.endswith("@nosey.guest")

    @computed_field
    @property
    def kojo_enabled(self) -> bool:
        return self.age is None or self.age >= 15


class AuthResponse(BaseModel):
    user_id: int
    access_token: str
    email: str
    user: UserResponse


class AdminTokenResponse(BaseModel):
    admin_token: str
    expires_in_seconds: int
    session_id: str
