from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.user import User


class UserJobDescription(Base, TimestampMixin):
    """A job description the user saved to reuse across mock interviews.

    Pasting a JD used to be a per-run action: the text went to the session that
    consumed it and the LLM parse was thrown away, so running the same company twice
    meant pasting and re-parsing. Saving it here keeps both the raw text and the parsed
    analysis (role focus, culture, seniority, chosen topics/subtopics/difficulties), so
    a repeat run is a dropdown pick with no LLM call.
    """

    __tablename__ = "user_job_descriptions"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_user_jd_user_name"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # User-facing label for the saved JD, unique per user so the picker has no duplicates.
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Hiring company as parsed from the JD (or typed by the user). Drives the interview's
    # display name when this JD is loaded.
    company_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    jd_text: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON blob of the parsed analysis plus the config the user settled on:
    # {role_focus, culture, seniority, topics, subtopics, difficulties}.
    parsed_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="job_descriptions")

    def __repr__(self) -> str:
        return f"UserJobDescription(id={self.id!r}, user_id={self.user_id!r}, name={self.name!r})"
