"""Idle TTS audio expiry (services/audio_cache.py): rows not played within the
TTL are deleted by the periodic sweep; playing a row keeps it alive."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.config import settings
from src.models.lc_sync import LCLectureAudio, LCWalkthroughAudio
from src.models.narration_clip import NarrationClip
from src.models.user import User
from src.services import audio_cache, upload_recovery
from src.services.audio_cache import TOUCH_EVERY, purge_idle_audio, touch

pytestmark = pytest.mark.asyncio


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _seed(maker, idle: timedelta) -> None:
    """One row per audio table, each last played `idle` ago."""
    stamp = _now() - idle
    async with maker() as session:
        user = User(email=f"audio{idle.total_seconds()}@example.com", google_id=f"g-audio-{idle.total_seconds()}")
        session.add(user)
        await session.flush()
        tag = str(int(idle.total_seconds()))
        session.add_all([
            NarrationClip(voice="af_heart", text_hash=f"h{tag}", audio=b"mp3", size_bytes=3, last_used_at=stamp),
            LCWalkthroughAudio(user_id=user.id, problem_slug=f"two-sum-{tag}", voice="af_heart",
                               lines_hash=f"l{tag}", clips_json="[]", last_used_at=stamp),
            LCLectureAudio(lecture_slug=f"prefix-sum-{tag}", voice="af_heart",
                           lines_hash=f"l{tag}", clips_json="{}", last_used_at=stamp),
        ])
        await session.commit()


async def _counts(maker) -> tuple[int, int, int]:
    counts = []
    async with maker() as session:
        for model in (NarrationClip, LCWalkthroughAudio, LCLectureAudio):
            counts.append(len((await session.scalars(select(model))).all()))
    return tuple(counts)


async def test_purge_deletes_only_audio_idle_past_the_ttl(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(settings, "audio_cache_ttl_hours", 10)
    await _seed(db_session_maker, idle=timedelta(hours=11))
    await _seed(db_session_maker, idle=timedelta(hours=9))

    async with db_session_maker() as session:
        purged = await purge_idle_audio(session)

    assert purged == {"narration_clips": 1, "lc_walkthrough_audio": 1, "lc_lecture_audio": 1}
    assert await _counts(db_session_maker) == (1, 1, 1)


async def test_ttl_comes_from_settings(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(settings, "audio_cache_ttl_hours", 2)
    await _seed(db_session_maker, idle=timedelta(hours=3))

    async with db_session_maker() as session:
        await purge_idle_audio(session)

    assert await _counts(db_session_maker) == (0, 0, 0)


async def test_touch_restamps_a_stale_row_so_it_survives_the_purge(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(settings, "audio_cache_ttl_hours", 10)
    await _seed(db_session_maker, idle=timedelta(hours=11))

    async with db_session_maker() as session:
        for model in (NarrationClip, LCWalkthroughAudio, LCLectureAudio):
            row = (await session.scalars(select(model))).one()
            await touch(session, row)
        purged = await purge_idle_audio(session)

    assert purged == {"narration_clips": 0, "lc_walkthrough_audio": 0, "lc_lecture_audio": 0}
    assert await _counts(db_session_maker) == (1, 1, 1)


async def test_touch_skips_the_write_when_recently_stamped(db_session_maker) -> None:
    await _seed(db_session_maker, idle=timedelta(minutes=1))

    async with db_session_maker() as session:
        row = (await session.scalars(select(NarrationClip))).one()
        before = row.last_used_at
        await touch(session, row)
        assert row.last_used_at == before

        later = before + TOUCH_EVERY + timedelta(seconds=1)
        await touch(session, row, now=later)
        assert row.last_used_at == later


async def test_periodic_sweep_purges_idle_audio(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(upload_recovery, "async_session_maker", db_session_maker)
    monkeypatch.setattr(settings, "audio_cache_ttl_hours", 10)
    await _seed(db_session_maker, idle=timedelta(hours=11))
    rounds: list[float] = []

    async def one_round(seconds: float) -> None:
        rounds.append(seconds)
        if len(rounds) > 1:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await upload_recovery.run_periodic_sweep(interval_s=300, sleep=one_round)

    assert await _counts(db_session_maker) == (0, 0, 0)


async def test_every_audio_model_is_covered() -> None:
    assert {m.__tablename__ for m in audio_cache.AUDIO_MODELS} == {
        "narration_clips", "lc_walkthrough_audio", "lc_lecture_audio",
    }
