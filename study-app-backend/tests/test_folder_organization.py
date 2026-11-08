from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.database import get_session
from src.dependencies import get_current_user
from src.main import app
from src.models.flashcard import Flashcard
from src.models.folder import Folder
from src.models.user import User
from src.schemas.folder_schema import FolderUpdate
from src.services.folder_service import FolderService
from src.utils.exceptions import ResourceNotFoundException, ValidationException


async def seed(session):
    owner = User(email="owner@example.com", google_id="folder-owner")
    other = User(email="other@example.com", google_id="folder-other")
    session.add_all([owner, other])
    await session.flush()
    folders = [Folder(user_id=owner.id, name=name, is_archived=False,
                      created_at=datetime(2026, 1, 1) + timedelta(days=i))
               for i, name in enumerate(["Math", "Bio", "History"])]
    foreign = Folder(user_id=other.id, name="Private", is_archived=False)
    archived = Folder(user_id=owner.id, name="Old class", is_archived=True)
    session.add_all([*folders, foreign, archived])
    await session.commit()
    return owner.id, folders, foreign.id, archived.id


async def test_order_persists_between_sessions_and_new_folders_come_first(db_session_maker):
    async with db_session_maker() as session:
        uid, folders, _, _ = await seed(session)
        ids = [folder.id for folder in folders]
        service = FolderService()
        assert [f.id for f in await service.list_folders(uid, session)] == ids[::-1]
        await service.reorder_folders(uid, [ids[1], ids[2], ids[0]], session)
    async with db_session_maker() as session:
        assert [f.id for f in await service.list_folders(uid, session)] == [ids[1], ids[2], ids[0]]
        new = Folder(user_id=uid, name="New", is_archived=False)
        session.add(new)
        await session.commit()
        assert [f.id for f in await service.list_folders(uid, session)] == [new.id, ids[1], ids[2], ids[0]]


@pytest.mark.parametrize("bad_order", ["missing", "foreign", "archived", "duplicate"])
async def test_reorder_rejects_stale_or_unowned_sets_without_changing_order(db_session_maker, bad_order):
    async with db_session_maker() as session:
        uid, folders, foreign, archived = await seed(session)
        ids = [f.id for f in folders]
        order = {"missing": ids[:-1], "foreign": [foreign, *ids[1:]],
                 "archived": [archived, *ids[1:]], "duplicate": [ids[0], ids[0], ids[2]]}[bad_order]
        with pytest.raises(ValidationException):
            await FolderService().reorder_folders(uid, order, session)
        await session.rollback()
        assert [f.id for f in await FolderService().list_folders(uid, session)] == ids[::-1]


async def test_bulk_archive_preserves_contents_and_restore_keeps_order(db_session_maker):
    async with db_session_maker() as session:
        uid, folders, _, _ = await seed(session)
        ids = [f.id for f in folders]
        session.add(Flashcard(folder_id=ids[0], front="Q", back="A", source="manual"))
        await session.commit()
        service = FolderService()
        await service.reorder_folders(uid, ids, session)
        assert await service.bulk_action(uid, ids[:2], "archive", session) == 2
        assert [f.id for f in await service.list_folders(uid, session)] == ids[2:]
        assert await session.scalar(select(Flashcard.id).where(Flashcard.folder_id == ids[0]))
        await service.update_folder(ids[0], uid, FolderUpdate(is_archived=False), session)
        assert [f.id for f in await service.list_folders(uid, session)] == [ids[0], ids[2]]


@pytest.mark.parametrize("action", ["archive", "delete"])
async def test_bulk_rejects_foreign_or_missing_ids_atomically(db_session_maker, action):
    async with db_session_maker() as session:
        uid, folders, foreign, _ = await seed(session)
        ids = [f.id for f in folders]
        for invalid in [foreign, 99999]:
            with pytest.raises(ResourceNotFoundException):
                await FolderService().bulk_action(uid, [ids[0], invalid], action, session)
            await session.rollback()
            assert [f.id for f in await FolderService().list_folders(uid, session)] == ids[::-1]


async def test_bulk_delete_cascades_selected_contents_only(db_session_maker):
    async with db_session_maker() as session:
        uid, folders, foreign, _ = await seed(session)
        ids = [f.id for f in folders]
        session.add_all([Flashcard(folder_id=fid, front="Q", back="A", source="manual") for fid in ids])
        await session.commit()
        assert await FolderService().bulk_action(uid, ids[:2], "delete", session) == 2
        assert list(await session.scalars(select(Flashcard.folder_id))) == ids[2:]
        assert await session.get(Folder, foreign) is not None
        assert [f.id for f in await FolderService().list_folders(uid, session)] == ids[2:]


async def test_route_validation_and_static_order_route(monkeypatch):
    async def session_override():
        yield AsyncMock()

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=7)
    reordered = AsyncMock(return_value=[])
    bulk = AsyncMock(return_value=2)
    monkeypatch.setattr(FolderService, "reorder_folders", reordered)
    monkeypatch.setattr(FolderService, "bulk_action", bulk)
    try:
        async with AsyncClient(app=app, base_url="http://test") as client:
            result = await client.patch("/folders/order", json={"folder_ids": [3, 2]})
            assert result.status_code == 200
            reordered.assert_awaited_once()
            assert reordered.await_args.args[:2] == (7, [3, 2])
            result = await client.post("/folders/bulk", json={"folder_ids": [3, 2], "action": "archive"})
            assert result.json() == {"affected": 2}
            assert bulk.await_args.args[:3] == (7, [3, 2], "archive")
            for ids in [[], [1, 1], [0], [-1], list(range(1, 1002))]:
                assert (await client.patch("/folders/order", json={"folder_ids": ids})).status_code == 422
            assert (await client.post("/folders/bulk", json={"folder_ids": [1], "action": "oops"})).status_code == 422
    finally:
        app.dependency_overrides.clear()
