from __future__ import annotations

from decimal import Decimal
from typing import Optional, TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.test import Test
    from src.models.user import User
    from src.models.user_answer import UserAnswer


class UserAttempt(Base, TimestampMixin):
    __tablename__ = "user_attempts"
    __table_args__ = (
        UniqueConstraint("user_id", "test_id", "attempt_number", name="uq_attempt_user_test_number"),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    test_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("tests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    total_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    total_questions: Mapped[Optional[int]] = mapped_column(Integer)
    correct_count: Mapped[Optional[int]] = mapped_column(Integer)

    user: Mapped[User] = relationship("User", back_populates="user_attempts")
    test: Mapped[Test] = relationship("Test", back_populates="attempts")
    answers: Mapped[list[UserAnswer]] = relationship(
        "UserAnswer", back_populates="attempt", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"UserAttempt(id={self.id!r}, test_id={self.test_id!r}, number={self.attempt_number!r})"
