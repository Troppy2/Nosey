from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import update

from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.main import app
from src.models.flashcard import Flashcard, FlashcardAttempt
from src.models.folder import Folder
from src.models.user import User

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def seeded(db_session_maker):
    async with db_session_maker() as session:
        owner = User(email="testowner@example.com", google_id="g-owner-sr")
        session.add(owner)
        await session.flush()
        folder1 = Folder(user_id=owner.id, name="Biology")
        folder2 = Folder(user_id=owner.id, name="Chemistry")
        session.add_all([folder1, folder2])
        await session.flush()

        # Biology cards
        c1 = Flashcard(folder_id=folder1.id, front="Card 1", back="Back 1")
        c2 = Flashcard(folder_id=folder1.id, front="Card 2", back="Back 2")
        # Chemistry card
        c3 = Flashcard(folder_id=folder2.id, front="Card 3", back="Back 3")
        session.add_all([c1, c2, c3])
        await session.commit()
        return SimpleNamespace(
            user_id=owner.id,
            folder1_id=folder1.id,
            folder2_id=folder2.id,
            card1_id=c1.id,
            card2_id=c2.id,
            card3_id=c3.id,
        )


@pytest_asyncio.fixture
async def client(db_session_maker, seeded, monkeypatch):
    async def _session():
        async with db_session_maker() as session:
            yield session

    async def _user():
        return SimpleNamespace(id=seeded.user_id, is_admin=False, is_beta=False)

    monkeypatch.setattr(limiter, "enabled", False)
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user] = _user
    async with AsyncClient(app=app, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_attempt_legacy_correct_only_true(client, seeded):
    resp = await client.post(
        f"/folders/{seeded.folder1_id}/flashcards/{seeded.card1_id}/attempt",
        json={"correct": True, "time_ms": 1500},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reps"] == 1
    assert data["interval_days"] == 1
    assert data["lapses"] == 0
    assert data["ease"] == 2.45
    assert data["due_at"] is not None
    assert data["is_new"] is False


async def test_attempt_legacy_correct_only_false(client, seeded):
    resp = await client.post(
        f"/folders/{seeded.folder1_id}/flashcards/{seeded.card2_id}/attempt",
        json={"correct": False, "time_ms": 1200},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reps"] == 0
    assert data["interval_days"] == 0
    assert data["lapses"] == 1
    assert data["ease"] == 2.3
    assert data["difficulty"] == 3
    assert data["is_new"] is False


async def test_attempt_rating_easy(client, seeded):
    resp = await client.post(
        f"/folders/{seeded.folder1_id}/flashcards/{seeded.card1_id}/attempt",
        json={"rating": "easy", "time_ms": 900},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reps"] == 1
    assert data["interval_days"] == 1
    assert data["ease"] == 2.6


async def test_list_flashcards_order(client, seeded, db_session_maker):
    now = datetime.utcnow()
    async with db_session_maker() as session:
        # Make c1 overdue by 2 hours
        card1 = await session.get(Flashcard, seeded.card1_id)
        card1.due_at = now - timedelta(hours=2)
        # c2 is new (due_at is None)
        card2 = await session.get(Flashcard, seeded.card2_id)
        card2.due_at = None
        # Add c4 due in future (tomorrow)
        c4 = Flashcard(folder_id=seeded.folder1_id, front="Card 4 Future", back="Back 4", due_at=now + timedelta(days=1))
        # Add c5 overdue by 1 day (more overdue than c1)
        c5 = Flashcard(folder_id=seeded.folder1_id, front="Card 5 Older Due", back="Back 5", due_at=now - timedelta(days=1))
        session.add_all([c4, c5])
        await session.commit()

    resp = await client.get(f"/folders/{seeded.folder1_id}/flashcards")
    assert resp.status_code == 200
    items = resp.json()
    ids = [item["id"] for item in items]
    # Order expected: due (most overdue first: c5, c1), then new (c2), then rest (c4)
    assert ids[0] == c5.id
    assert ids[1] == seeded.card1_id
    assert ids[2] == seeded.card2_id
    assert ids[3] == c4.id


async def test_weak_flashcards(client, seeded, db_session_maker):
    async with db_session_maker() as session:
        card1 = await session.get(Flashcard, seeded.card1_id)
        card1.lapses = 3
        card2 = await session.get(Flashcard, seeded.card2_id)
        card2.lapses = 0
        card2.ease = 1.8  # ease < 2.0
        c_fine = Flashcard(folder_id=seeded.folder1_id, front="Fine", back="Fine", lapses=0, ease=2.5)
        session.add(c_fine)
        await session.commit()

    resp = await client.get(f"/folders/{seeded.folder1_id}/flashcards/weak")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    # Ordered by lapses desc
    assert items[0]["id"] == seeded.card1_id
    assert items[1]["id"] == seeded.card2_id


async def test_due_summary_endpoint(client, seeded, db_session_maker):
    now = datetime.utcnow()
    async with db_session_maker() as session:
        c1 = await session.get(Flashcard, seeded.card1_id)
        c1.due_at = now - timedelta(hours=5)
        c1.lapses = 1

        c2 = await session.get(Flashcard, seeded.card2_id)
        c2.due_at = now - timedelta(hours=1)
        c2.lapses = 2

        c3 = await session.get(Flashcard, seeded.card3_id)
        c3.due_at = now - timedelta(days=2)  # Most overdue in Chemistry
        c3.lapses = 0
        await session.commit()

    resp = await client.get("/flashcards/due-summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_due"] == 3
    assert len(data["folders"]) == 2
    # Biology has 2 due, Chemistry has 1 due
    bio = next(f for f in data["folders"] if f["folder_id"] == seeded.folder1_id)
    assert bio["due"] == 2
    chem = next(f for f in data["folders"] if f["folder_id"] == seeded.folder2_id)
    assert chem["due"] == 1

    # Top 3 cards ordered by overdue then lapses:
    # c3 (2 days ago), c1 (5 hours ago), c2 (1 hour ago)
    top_ids = [c["id"] for c in data["cards"]]
    assert top_ids == [seeded.card3_id, seeded.card1_id, seeded.card2_id]


async def test_attempt_due_at_is_utc_marked(client, seeded):
    resp = await client.post(
        f"/folders/{seeded.folder1_id}/flashcards/{seeded.card1_id}/attempt",
        json={"rating": "medium"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["due_at"].endswith("Z")
    assert data["last_reviewed_at"].endswith("Z")
    parsed = datetime.fromisoformat(data["due_at"].replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    assert parsed > datetime.now(timezone.utc)


async def test_attempt_without_rating_or_correct_is_422(client, seeded):
    resp = await client.post(
        f"/folders/{seeded.folder1_id}/flashcards/{seeded.card1_id}/attempt",
        json={"time_ms": 500},
    )
    assert resp.status_code == 422


async def test_due_summary_excludes_other_users_cards(client, seeded, db_session_maker):
    now = datetime.utcnow()
    async with db_session_maker() as session:
        other = User(email="other@example.com", google_id="g-other-sr")
        session.add(other)
        await session.flush()
        other_folder = Folder(user_id=other.id, name="Not Mine")
        session.add(other_folder)
        await session.flush()
        session.add(Flashcard(folder_id=other_folder.id, front="Theirs", back="B", due_at=now - timedelta(days=3)))
        mine = await session.get(Flashcard, seeded.card1_id)
        mine.due_at = now - timedelta(hours=1)
        await session.commit()

    resp = await client.get("/flashcards/due-summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_due"] == 1
    assert [c["id"] for c in data["cards"]] == [seeded.card1_id]
    assert all(c["due_at"].endswith("Z") for c in data["cards"])
    assert [f["folder_id"] for f in data["folders"]] == [seeded.folder1_id]


async def test_due_summary_excludes_archived_folders(client, seeded, db_session_maker):
    now = datetime.utcnow()
    async with db_session_maker() as session:
        # Explicit UPDATE: SQLite holds the server default as the text "false",
        # which the ORM reads back truthy, so assigning True would be a no-op.
        await session.execute(update(Folder).where(Folder.id == seeded.folder2_id).values(is_archived=True))
        c1 = await session.get(Flashcard, seeded.card1_id)
        c1.due_at = now - timedelta(hours=1)
        c3 = await session.get(Flashcard, seeded.card3_id)
        c3.due_at = now - timedelta(days=2)
        await session.commit()

    resp = await client.get("/flashcards/due-summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_due"] == 1
    assert [c["id"] for c in data["cards"]] == [seeded.card1_id]
    assert [f["folder_id"] for f in data["folders"]] == [seeded.folder1_id]
