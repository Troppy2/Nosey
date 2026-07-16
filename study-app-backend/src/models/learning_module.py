from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import BIGINT_ID, Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.folder import Folder


class LearningTrack(Base, TimestampMixin):
    """An AI-authored learning track built from a folder's saved notes.

    A folder has at most one ACTIVE track (regenerating replaces it) plus any
    number of archived tracks kept for later review. The partial unique index
    enforces the "one active track per folder" rule while letting archived
    tracks accumulate. The track owns up to 20 ordered LearningModule rows;
    generation runs as a detached background task (same pattern as test
    generation) and fills modules in one by one, so the frontend can poll and
    show progress while the track builds.
    """

    __tablename__ = "learning_tracks"
    __table_args__ = (
        Index(
            "uq_learning_tracks_active_folder",
            "folder_id",
            unique=True,
            postgresql_where=text("is_archived = false"),
            sqlite_where=text("is_archived = 0"),
        ),
    )

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    folder_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("folders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # generating | ready | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="generating", server_default="generating")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # How many modules the user asked for (1-20). Modules appear as they generate.
    module_count: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    # SHA-256 of the folder notes used to build this track. Compared against the
    # current folder files on read so the UI can offer a rebuild when notes change.
    notes_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    provider: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Free-text user guidance applied to outline, lesson, and quiz prompts
    # (e.g. "focus on proofs", "explain like I'm new to the subject"). Stored so
    # a rebuild reuses the same instructions.
    custom_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Soft-archive: an archived track drops out of the folder's active slot
    # (freeing it for a new build) but is kept so the user can revisit it.
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    folder: Mapped[Folder] = relationship("Folder")
    modules: Mapped[list[LearningModule]] = relationship(
        "LearningModule",
        back_populates="track",
        cascade="all, delete-orphan",
        order_by="LearningModule.order_index",
    )

    def __repr__(self) -> str:
        return f"LearningTrack(id={self.id!r}, folder_id={self.folder_id!r}, status={self.status!r})"


class LearningModule(Base, TimestampMixin):
    """One lesson + quiz step in a LearningTrack.

    lesson_content, tts_script, and quiz_json are nullable: the outline call
    creates the row (title + summary) first, then one bundled LLM call fills in
    lesson + tts_script + quiz together. A module is "ready" once lesson and
    quiz are present. Folders are single-user, so quiz progress
    (best_score / passed) lives directly on the row.
    """

    __tablename__ = "learning_modules"

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    track_id: Mapped[int] = mapped_column(
        BIGINT_ID, ForeignKey("learning_tracks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Markdown lesson article (multi-section; may contain LaTeX/code fences).
    lesson_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # LLM-written spoken script mirroring the lesson paragraph by paragraph,
    # with math/code described in words so TTS never reads raw LaTeX. Nullable
    # for tracks generated before this column existed; the frontend falls back
    # to stripping markdown from lesson_content when absent.
    tts_script: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # JSON array of {"question": str, "options": [str], "correct_index": int}.
    # Correct answers are stripped before this reaches the client; grading is
    # done server-side on quiz submit.
    quiz_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # One optional user-attached video link, embedded at the bottom of the
    # article. Display only; never fed to the LLM.
    video_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    best_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    track: Mapped[LearningTrack] = relationship("LearningTrack", back_populates="modules")

    def __repr__(self) -> str:
        return f"LearningModule(id={self.id!r}, track_id={self.track_id!r}, title={self.title!r})"
