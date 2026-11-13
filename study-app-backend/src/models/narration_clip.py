from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, LargeBinary, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import BIGINT_ID, Base, TimestampMixin


class NarrationClip(Base, TimestampMixin):
    """One narrated chunk of text, stored as low-bitrate audio.

    Keyed by the voice and a hash of the exact text, not by lesson, so the same sentence is
    never generated twice and an edited lesson only regenerates what changed. Shared across
    users: the audio holds nothing but the text that was spoken.
    """

    __tablename__ = "narration_clips"
    __table_args__ = (UniqueConstraint("voice", "text_hash", name="uq_narration_clip_voice_hash"),)

    id: Mapped[int] = mapped_column(BIGINT_ID, primary_key=True, autoincrement=True)
    voice: Mapped[str] = mapped_column(String(32), nullable=False)
    text_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    audio: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    content_type: Mapped[str] = mapped_column(String(32), nullable=False, default="audio/mpeg")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Bumped when the clip is served; idle clips are purged (services/audio_cache.py).
    last_used_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
