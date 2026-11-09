from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import event

from src.database import get_session
from src.dependencies import get_current_user
from src.main import app
from src.models.folder import Folder
from src.models.test import Test
from src.models.user import User
from src.services.folder_search_service import FolderSearchService


async def seed(session):
    owner = User(email="search-owner@example.com", google_id="search-owner")
    other = User(email="search-other@example.com", google_id="search-other")
    session.add_all([owner, other])
    await session.flush()
    folders = [Folder(user_id=owner.id, name="Biology", subject="Science", is_archived=False),
               Folder(user_id=owner.id, name="Advanced biology", is_archived=False),
               Folder(user_id=owner.id, name="Biology archived", is_archived=True),
               Folder(user_id=other.id, name="Biology secret", is_archived=False),
               Folder(user_id=owner.id, name="100%_complete / study", is_archived=False)]
    session.add_all(folders)
    await session.flush()
    tests = [Test(folder_id=folder.id, title="Biology", test_type="mixed") for folder in folders[:4]]
    session.add_all(tests)
    await session.commit()
    return owner.id, folders, tests


async def test_owned_active_results_ranked_and_lean_in_one_query(db_session_maker):
    async with db_session_maker() as session:
        uid, folders, tests = await seed(session)
        queries = []
        connection = await session.connection()
        event.listen(connection.sync_connection, "before_cursor_execute", lambda *args: queries.append(args[2]))
        result = await FolderSearchService().search(uid, "  BIOLOGY  ", session)
        assert [(r.kind, r.id) for r in result.results] == [
            ("folder", folders[0].id), ("test", tests[0].id), ("test", tests[1].id), ("folder", folders[1].id),
        ]
        assert result.results[1].folder_name == "Biology"
        assert result.results[0].subject == "Science" and result.results[1].subject is None
        assert set(result.results[1].model_dump()) == {"kind", "id", "title", "folder_id", "folder_name", "subject"}
        assert len(queries) == 1
        assert "questions" not in queries[0] and "description" not in queries[0]


@pytest.mark.parametrize("query,expected", [("%_", []), ("100%_", ["100%_complete / study"]),
                                            ("/ study", ["100%_complete / study"]), ("Bi", ["Biology"]),
                                            ("gy", []), ("xyz", [])])
async def test_literals_short_prefix_and_no_matches(db_session_maker, query, expected):
    async with db_session_maker() as session:
        uid, _, _ = await seed(session)
        result = await FolderSearchService().search(uid, query, session)
        assert [r.title for r in result.results if r.kind == "folder"] == expected


async def test_empty_does_not_query_and_limit_has_more(db_session_maker):
    session = AsyncMock()
    assert (await FolderSearchService().search(1, " \t ", session)).results == []
    session.execute.assert_not_called()
    async with db_session_maker() as session:
        uid, _, _ = await seed(session)
        result = await FolderSearchService().search(uid, "biology", session, 2)
        assert len(result.results) == 2 and result.has_more


async def test_route_auth_validation_and_static_route_before_folder_id(db_session_maker):
    async with db_session_maker() as session:
        uid, _, _ = await seed(session)
        async def get_test_session():
            yield session
        app.dependency_overrides[get_session] = get_test_session
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=uid)
        try:
            async with AsyncClient(app=app, base_url="http://test") as client:
                result = await client.get("/folders/search", params={"q": "biology"})
                assert result.status_code == 200 and len(result.json()["results"]) == 4
                assert (await client.get("/folders/search")).json() == {"results": [], "has_more": False}
                for params in ({"q": "a" * 161}, {"limit": 21}, {"limit": 0}):
                    assert (await client.get("/folders/search", params=params)).status_code == 422
                app.dependency_overrides.pop(get_current_user)
                assert (await client.get("/folders/search", params={"q": "biology"})).status_code == 401
        finally:
            app.dependency_overrides.clear()
