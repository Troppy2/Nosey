import io
from types import SimpleNamespace

import numpy as np
import pytest
import pytest_asyncio
import soundfile as sf
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.database import get_session
from src.dependencies import get_current_user
from src.routes import speech
from src.services import narration_service as ns


def _mp3() -> bytes:
    buf = io.BytesIO()
    sf.write(buf, (0.2 * np.sin(np.linspace(0, 900, 24000))).astype("float32"), 24000, format="MP3", subtype="MPEG_LAYER_III")
    return buf.getvalue()


@pytest_asyncio.fixture
async def client(db_session_maker, monkeypatch):
    app = FastAPI()
    app.include_router(speech.router)
    user = SimpleNamespace(id=7, email="a@b.co", is_admin=False, is_beta=False)

    async def session_dep():
        async with db_session_maker() as session:
            yield session

    app.dependency_overrides[get_session] = session_dep
    app.dependency_overrides[get_current_user] = lambda: user
    app.state.user = user
    speech._recent.clear()
    speech._used.clear()
    calls: list[str] = []

    async def fake_synthesize(self, text, voice_override=None):
        calls.append(text)
        return _mp3()

    monkeypatch.setattr(ns.SpeechService, "synthesize", fake_synthesize)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.calls = calls  # type: ignore[attr-defined]
        c.user = user  # type: ignore[attr-defined]
        yield c


@pytest.mark.asyncio
async def test_second_request_for_the_same_text_is_served_from_the_database(client):
    first = await client.post("/speech/tts", json={"text": "Hello there.", "voice": "af_heart"})
    second = await client.post("/speech/tts", json={"text": "Hello there.", "voice": "af_heart"})
    assert first.status_code == second.status_code == 200
    assert first.headers["content-type"] == "audio/mpeg"
    assert first.content == second.content
    assert len(client.calls) == 1


@pytest.mark.asyncio
async def test_cache_hits_do_not_use_the_daily_character_budget(client):
    await client.post("/speech/tts", json={"text": "Budget check.", "voice": "af_heart"})
    used_after_first = speech._used[7][1]
    for _ in range(5):
        await client.post("/speech/tts", json={"text": "Budget check.", "voice": "af_heart"})
    assert speech._used[7][1] == used_after_first == len("Budget check.")


@pytest.mark.asyncio
async def test_generating_past_the_daily_cap_is_refused(client, monkeypatch):
    monkeypatch.setattr(speech, "DAILY_CHAR_CAP", 10)
    ok = await client.post("/speech/tts", json={"text": "short", "voice": "af_heart"})
    over = await client.post("/speech/tts", json={"text": "this one is too long", "voice": "af_heart"})
    assert ok.status_code == 200
    assert over.status_code == 429


@pytest.mark.asyncio
async def test_unknown_voice_and_guests_are_refused(client):
    assert (await client.post("/speech/tts", json={"text": "x", "voice": "evil"})).status_code == 400
    client.user.email = "g@nosey.guest"
    assert (await client.post("/speech/tts", json={"text": "x", "voice": "af_heart"})).status_code == 403


@pytest.mark.asyncio
async def test_narration_still_works_when_the_cache_table_is_missing(client, monkeypatch):
    from sqlalchemy.exc import ProgrammingError

    async def broken(*args, **kwargs):
        raise ProgrammingError("select", {}, Exception('relation "narration_clips" does not exist'))

    monkeypatch.setattr(speech, "get_clip", broken)
    res = await client.post("/speech/tts", json={"text": "No table yet.", "voice": "af_heart"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/mpeg"
    assert len(client.calls) == 1
