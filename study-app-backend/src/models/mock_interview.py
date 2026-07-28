from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.user import User


class MockInterviewSession(Base, TimestampMixin):
    __tablename__ = "mock_interview_sessions"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    company: Mapped[str] = mapped_column(String(64), nullable=False)
    # Target seniority level: intern | junior | mid | senior. Drives coding
    # difficulty distribution and interviewer rigor. Defaults to intern.
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="intern", server_default="intern")

    # Custom company (company == "custom"): the interview is built from a pasted job
    # description instead of a hardcoded FAANG profile. custom_company is the display
    # name, jd_text the raw description, and custom_config a JSON blob of
    # {role_focus, culture, topics: [...], difficulties: [...], problems: [{slug,title,difficulty}]}.
    # All null for the built-in companies.
    custom_company: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    jd_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    custom_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # JSON array of stage keys, e.g. ["stage1", "stage2", "stage3"]
    stages_config: Mapped[str] = mapped_column(Text, nullable=False, default='["stage1","stage2","stage3"]')
    # Lifecycle (forward-only): pending, stage1_complete, stage2, stage2_complete,
    # stage3, stage3_complete, complete. See routes/mock_interview.py STATUS_* constants.
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")

    # Resume Screen (optional first stage): ATS evaluation result JSON.
    resume_screen: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Stage 1 OA results JSON: [{slug, title, difficulty, code, verdict, feedback}]
    stage1_results: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Stage 2 code submission JSON ({code, feedback}).
    # stage2_script is legacy (the old pre-generated script flow) and is no longer
    # written; the column is retained to avoid a destructive migration.
    stage2_script: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stage2_submission: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Stage 3 conversational behavioral feedback JSON ({feedback}).
    # stage3_script is legacy and no longer written (retained to avoid a migration).
    stage3_script: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stage3_answers: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Final LLM-generated overall feedback
    overall_feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="mock_interview_sessions")
