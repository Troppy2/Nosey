"""Quizlet import: bulk save of reviewed cards and the Kojo tidy pass."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.main import app
from src.models.flashcard import Flashcard
from src.models.folder import Folder
from src.models.user import User
from src.services.llm_service import GeneratedFlashcard, LLMService
from src.services.quota_service import QuotaService
from src.utils.exceptions import LLMException

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def seeded(db_session_maker):
    async with db_session_maker() as session:
        owner = User(email="owner@example.com", google_id="g-owner")
        other = User(email="other@example.com", google_id="g-other")
        session.add_all([owner, other])
        await session.flush()
        mine = Folder(user_id=owner.id, name="Spanish")
        theirs = Folder(user_id=other.id, name="Not yours")
        session.add_all([mine, theirs])
        await session.commit()
        return SimpleNamespace(user_id=owner.id, folder_id=mine.id, other_folder_id=theirs.id)


class _Slot:
    released = 0

    def release(self) -> None:
        _Slot.released += 1


@pytest_asyncio.fixture
async def client(db_session_maker, seeded, monkeypatch):
    async def _session():
        async with db_session_maker() as session:
            yield session

    async def _user():
        return SimpleNamespace(id=seeded.user_id, is_admin=False, is_beta=False)

    async def _acquire(self, session, user):
        return _Slot()

    monkeypatch.setattr(QuotaService, "acquire_kojo", _acquire)
    monkeypatch.setattr(limiter, "enabled", False)
    _Slot.released = 0
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user] = _user
    try:
        async with AsyncClient(app=app, base_url="http://test") as http:
            yield http
    finally:
        app.dependency_overrides.clear()


async def test_import_saves_cards_in_order_with_source(client, db_session_maker, seeded) -> None:
    cards = [{"front": "  hola ", "back": "hello"}, {"front": "adios", "back": "goodbye, see you"}]

    response = await client.post(f"/folders/{seeded.folder_id}/flashcards/import", json={"cards": cards})

    assert response.status_code == 201
    body = response.json()
    assert [(c["front"], c["back"]) for c in body] == [("hola", "hello"), ("adios", "goodbye, see you")]
    async with db_session_maker() as session:
        rows = (await session.scalars(select(Flashcard).order_by(Flashcard.id))).all()
    assert [r.source for r in rows] == ["quizlet_import", "quizlet_import"]
    assert all(r.folder_id == seeded.folder_id for r in rows)


async def test_import_into_someone_elses_folder_is_404(client, db_session_maker, seeded) -> None:
    response = await client.post(
        f"/folders/{seeded.other_folder_id}/flashcards/import",
        json={"cards": [{"front": "a", "back": "b"}]},
    )

    assert response.status_code == 404
    async with db_session_maker() as session:
        assert (await session.scalars(select(Flashcard))).all() == []


@pytest.mark.parametrize(
    "payload",
    [
        {"cards": []},
        {"cards": [{"front": "a", "back": "b"}] * 1001},
        {"cards": [{"front": "   ", "back": "b"}]},
        {"cards": [{"front": "a", "back": "x" * 5001}]},
        {"cards": [{"front": "a", "back": "b"}], "source": "generated_from_test"},
    ],
    ids=["empty", "over-1000", "blank-side", "side-too-long", "foreign-source"],
)
async def test_import_rejects_bad_payloads(client, seeded, payload) -> None:
    response = await client.post(f"/folders/{seeded.folder_id}/flashcards/import", json=payload)

    assert response.status_code == 422


async def test_tidy_flags_pairs_not_copied_word_for_word(client, monkeypatch) -> None:
    pasted = "Terms in this set (2)\nPhotosynthesis\nPlants  turn LIGHT into energy\nMitosis\nCell division"

    async def _extract(self, text, provider=None):
        assert text == pasted
        return [
            GeneratedFlashcard(front="photosynthesis", back="Plants turn light into energy"),
            GeneratedFlashcard(front="Mitosis", back="The cell divides into two"),
            # Both sides are real text, but this definition comes before the term.
            GeneratedFlashcard(front="Mitosis", back="Plants turn light into energy"),
        ]

    monkeypatch.setattr(LLMService, "extract_flashcard_pairs", _extract)

    response = await client.post("/flashcards/import/tidy", json={"text": pasted})

    assert response.status_code == 200
    assert response.json()["cards"] == [
        {"front": "photosynthesis", "back": "Plants turn light into energy", "verbatim": True},
        {"front": "Mitosis", "back": "The cell divides into two", "verbatim": False},
        {"front": "Mitosis", "back": "Plants turn light into energy", "verbatim": False},
    ]
    assert _Slot.released == 1


async def test_tidy_with_no_pairs_is_400(client, monkeypatch) -> None:
    async def _extract(self, text, provider=None):
        return []

    monkeypatch.setattr(LLMService, "extract_flashcard_pairs", _extract)

    response = await client.post("/flashcards/import/tidy", json={"text": "nothing useful here"})

    assert response.status_code == 400
    assert "Kojo couldn't find" in response.json()["detail"]
    assert _Slot.released == 1


async def test_tidy_provider_outage_is_503_and_releases_the_slot(client, monkeypatch) -> None:
    async def _extract(self, text, provider=None):
        raise LLMException("All AI services are unavailable.")

    monkeypatch.setattr(LLMService, "extract_flashcard_pairs", _extract)

    response = await client.post("/flashcards/import/tidy", json={"text": "term\tdefinition"})

    assert response.status_code == 503
    assert _Slot.released == 1


async def test_tidy_rejects_text_over_the_cap(client) -> None:
    response = await client.post("/flashcards/import/tidy", json={"text": "x" * 12001})

    assert response.status_code == 422


async def test_extract_flashcard_pairs_is_one_json_call(monkeypatch) -> None:
    calls: list[str] = []

    async def _complete_json(self, prompt, provider=None, max_tokens=None):
        calls.append(prompt)
        return {"flashcards": [{"front": "hola", "back": "hello"}, {"front": "", "back": "dropped"}]}

    monkeypatch.setattr(LLMService, "_complete_json", _complete_json)

    pairs = await LLMService().extract_flashcard_pairs("hola - hello")

    assert pairs == [GeneratedFlashcard(front="hola", back="hello")]
    assert len(calls) == 1
    assert "hola - hello" in calls[0]


async def test_extract_flashcard_pairs_malformed_reply_is_empty(monkeypatch) -> None:
    async def _complete_json(self, prompt, provider=None, max_tokens=None):
        return {"flashcards": "not a list"}

    monkeypatch.setattr(LLMService, "_complete_json", _complete_json)

    assert await LLMService().extract_flashcard_pairs("anything") == []
