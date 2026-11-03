from __future__ import annotations

import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.main import app
from src.models.flashcard import Flashcard, FlashcardAttempt
from src.models.folder import Folder
from src.models.learning_module import LearningModule, LearningTrack
from src.models.study_plan import StudyPlan, StudyPlanItem
from src.models.test import Test
from src.models.user import User
from src.models.user_attempt import UserAttempt
from src.schemas.study_plan import (
    StudyPlanCreateRequest,
    StudyPlanItemCreate,
    StudyPlanItemIn,
    StudyPlanReplaceItemsRequest,
    StudyPlanUpdateRequest,
)
from src.services.llm_service import LLMService
from src.services.mcp_plan_tools import (
    CreateStudyPlanArgs,
    DeleteStudyPlanArgs,
    GetStudyPlanArgs,
    ListStudyPlansArgs,
    SetPlanItemDoneArgs,
    UpdateStudyPlanItemsArgs,
    create_study_plan,
    delete_study_plan,
    get_study_plan,
    list_study_plans,
    set_plan_item_done,
    update_study_plan_items,
)
from src.services.mcp_tool_base import McpContext, ToolInputError
from src.services.study_plan_service import StudyPlanService
from src.utils.exceptions import ValidationException

pytestmark = pytest.mark.asyncio


async def _create_user(session, email: str, is_beta: bool = True, is_admin: bool = False) -> User:
    user = User(
        email=email,
        google_id=f"g_{email}",
        full_name="Test User",
        is_beta=is_beta,
        is_admin=is_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_folder(session, user_id: int, name: str = "Bio 101") -> Folder:
    folder = Folder(user_id=user_id, name=name)
    session.add(folder)
    await session.commit()
    await session.refresh(folder)
    return folder


async def _create_test(session, folder_id: int, title: str = "Midterm Practice") -> Test:
    t = Test(folder_id=folder_id, title=title, test_type="standard")
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return t


# ---------------------------------------------------------------- Auto-completion tests

async def test_auto_completion_work_after_vs_before_created(db_session_maker):
    async with db_session_maker() as session:
        user = await _create_user(session, "student1@test.com")
        folder = await _create_folder(session, user.id)
        test1 = await _create_test(session, folder.id, "Exam 1")
        test2 = await _create_test(session, folder.id, "Exam 2")

        base_time = datetime.datetime(2026, 11, 1, 10, 0, 0)
        item_time = datetime.datetime(2026, 11, 1, 12, 0, 0)
        after_time = datetime.datetime(2026, 11, 1, 14, 0, 0)

        # Prior attempt for test1 before plan item is created
        old_attempt = UserAttempt(
            user_id=user.id,
            test_id=test1.id,
            attempt_number=1,
            status="submitted",
            created_at=base_time,
        )
        session.add(old_attempt)
        await session.commit()

        service = StudyPlanService()
        req = StudyPlanCreateRequest(
            title="Biology Final Prep",
            items=[
                StudyPlanItemCreate(kind="test", label="Take Exam 1", target_id=test1.id),
                StudyPlanItemCreate(kind="test", label="Take Exam 2", target_id=test2.id),
            ],
        )
        plan_resp = await service.create_plan(user.id, req, session)
        item1_id = plan_resp.items[0].id
        item2_id = plan_resp.items[1].id

        # Set items created_at to item_time
        items = (await session.scalars(select(StudyPlanItem).where(StudyPlanItem.plan_id == plan_resp.id))).all()
        for it in items:
            it.created_at = item_time
        await session.commit()

        # Verify old attempt does NOT auto-complete item1
        detail1 = await service.get_plan(plan_resp.id, user.id, session)
        item1 = next(it for it in detail1.items if it.id == item1_id)
        item2 = next(it for it in detail1.items if it.id == item2_id)
        assert item1.done is False
        assert item2.done is False

        # Now submit an attempt for test2 AFTER item was created
        new_attempt = UserAttempt(
            user_id=user.id,
            test_id=test2.id,
            attempt_number=1,
            status="submitted",
            created_at=after_time,
        )
        session.add(new_attempt)
        await session.commit()

        # Item 2 should auto-complete
        detail2 = await service.get_plan(plan_resp.id, user.id, session)
        item2_after = next(it for it in detail2.items if it.id == item2_id)
        assert item2_after.done is True
        assert item2_after.done_source == "auto"


async def test_auto_completion_flashcards_progress_and_completion(db_session_maker):
    async with db_session_maker() as session:
        user = await _create_user(session, "student2@test.com")
        folder = await _create_folder(session, user.id)
        card = Flashcard(folder_id=folder.id, front="Mitochondria", back="Powerhouse")
        session.add(card)
        await session.commit()

        base_time = datetime.datetime(2026, 11, 1, 10, 0, 0)
        item_time = datetime.datetime(2026, 11, 1, 12, 0, 0)
        after1 = datetime.datetime(2026, 11, 1, 13, 0, 0)
        after2 = datetime.datetime(2026, 11, 1, 14, 0, 0)

        # Prior attempt before item is created
        old_review = FlashcardAttempt(user_id=user.id, flashcard_id=card.id, correct=True, created_at=base_time)
        session.add(old_review)
        await session.commit()

        service = StudyPlanService()
        req = StudyPlanCreateRequest(
            title="Flashcard Plan",
            items=[
                StudyPlanItemCreate(
                    kind="flashcards",
                    label="Review 2 cards",
                    target_id=folder.id,
                    target_count=2,
                )
            ],
        )
        plan_resp = await service.create_plan(user.id, req, session)
        item_id = plan_resp.items[0].id

        # Set item created_at
        it_row = await session.scalar(select(StudyPlanItem).where(StudyPlanItem.id == item_id))
        it_row.created_at = item_time
        await session.commit()

        # Old review should not count
        d1 = await service.get_plan(plan_resp.id, user.id, session)
        it1 = next(i for i in d1.items if i.id == item_id)
        assert it1.done is False
        assert it1.progress == "0/2"

        # Log 1 review after item creation
        r1 = FlashcardAttempt(user_id=user.id, flashcard_id=card.id, correct=True, created_at=after1)
        session.add(r1)
        await session.commit()

        d2 = await service.get_plan(plan_resp.id, user.id, session)
        it2 = next(i for i in d2.items if i.id == item_id)
        assert it2.done is False
        assert it2.progress == "1/2"

        # Log second review
        r2 = FlashcardAttempt(user_id=user.id, flashcard_id=card.id, correct=True, created_at=after2)
        session.add(r2)
        await session.commit()

        d3 = await service.get_plan(plan_resp.id, user.id, session)
        it3 = next(i for i in d3.items if i.id == item_id)
        assert it3.done is True
        assert it3.done_source == "auto"
        assert it3.progress == "2/2"


async def test_manual_untick_stays_unticked(db_session_maker):
    async with db_session_maker() as session:
        user = await _create_user(session, "student3@test.com")
        folder = await _create_folder(session, user.id)
        t = await _create_test(session, folder.id, "History Test")

        item_time = datetime.datetime(2026, 11, 1, 10, 0, 0)
        after_time = datetime.datetime(2026, 11, 1, 12, 0, 0)

        service = StudyPlanService()
        plan_resp = await service.create_plan(
            user.id,
            StudyPlanCreateRequest(
                title="History",
                items=[StudyPlanItemCreate(kind="test", label="Test", target_id=t.id)],
            ),
            session,
        )
        item_id = plan_resp.items[0].id

        it_row = await session.scalar(select(StudyPlanItem).where(StudyPlanItem.id == item_id))
        it_row.created_at = item_time
        await session.commit()

        # Submit attempt after creation -> auto-completes
        attempt = UserAttempt(user_id=user.id, test_id=t.id, attempt_number=1, status="submitted", created_at=after_time)
        session.add(attempt)
        await session.commit()

        d1 = await service.get_plan(plan_resp.id, user.id, session)
        assert d1.items[0].done is True
        assert d1.items[0].done_source == "auto"

        # User manually unticks
        await service.toggle_item_done(item_id, user.id, done=False, session=session)

        # Re-reading plan must keep it unticked
        d2 = await service.get_plan(plan_resp.id, user.id, session)
        assert d2.items[0].done is False
        assert d2.items[0].done_source == "manual"


# ---------------------------------------------------------------- Pin exclusivity tests

async def test_pin_exclusivity(db_session_maker):
    async with db_session_maker() as session:
        user = await _create_user(session, "pinner@test.com")
        service = StudyPlanService()

        # Create Plan A pinned
        plan_a = await service.create_plan(
            user.id,
            StudyPlanCreateRequest(title="Plan A", is_pinned=True),
            session,
        )
        assert plan_a.is_pinned is True

        # Pinned plan check
        pinned = await service.get_pinned_plan(user.id, session)
        assert pinned is not None
        assert pinned.id == plan_a.id

        # Create Plan B pinned -> Plan A is unpinned
        plan_b = await service.create_plan(
            user.id,
            StudyPlanCreateRequest(title="Plan B", is_pinned=True),
            session,
        )
        assert plan_b.is_pinned is True

        plan_a_refreshed = await service.get_plan(plan_a.id, user.id, session)
        assert plan_a_refreshed.is_pinned is False

        # Updating Plan A to pinned unpins Plan B
        await service.update_plan(
            plan_a.id,
            user.id,
            StudyPlanUpdateRequest(is_pinned=True),
            session,
        )
        plan_a_now = await service.get_plan(plan_a.id, user.id, session)
        plan_b_now = await service.get_plan(plan_b.id, user.id, session)
        assert plan_a_now.is_pinned is True
        assert plan_b_now.is_pinned is False


# ---------------------------------------------------------------- Catalog ownership tests

async def test_catalog_ownership_validation(db_session_maker):
    async with db_session_maker() as session:
        user1 = await _create_user(session, "user1@test.com")
        user2 = await _create_user(session, "user2@test.com")
        folder2 = await _create_folder(session, user2.id, "User 2 Folder")
        test2 = await _create_test(session, folder2.id, "User 2 Test")

        service = StudyPlanService()

        # user1 tries to create plan linking user2's test
        with pytest.raises(ValidationException):
            await service.create_plan(
                user1.id,
                StudyPlanCreateRequest(
                    title="Sneaky Plan",
                    items=[StudyPlanItemCreate(kind="test", label="Steal Test", target_id=test2.id)],
                ),
                session,
            )

        # user1 creates legitimate plan
        plan = await service.create_plan(
            user1.id,
            StudyPlanCreateRequest(title="Legit Plan", items=[]),
            session,
        )

        # user1 tries to replace items linking user2's test
        with pytest.raises(ValidationException):
            await service.replace_items(
                plan.id,
                user1.id,
                StudyPlanReplaceItemsRequest(
                    items=[StudyPlanItemIn(kind="test", label="Steal Test", target_id=test2.id)],
                ),
                session,
            )


# ---------------------------------------------------------------- Draft sanitizing tests

async def test_draft_sanitizing_and_clamping():
    service = LLMService()

    fake_catalog = [
        {"kind": "test", "id": 10, "title": "Math 101 Midterm"},
        {"kind": "flashcards", "id": 20, "title": "Physics Deck"},
    ]

    mock_llm_json = {
        "title": "My Big Exam Prep",
        "exam_date": "2026-12-15",
        "items": [
            {"kind": "test", "target_id": 10, "label": "Take Math 101 Midterm", "due_date": "2026-12-01"},
            {"kind": "test", "target_id": 999, "label": "Take Unknown Exam", "due_date": "invalid-date"},
            {"kind": "flashcards", "target_id": 20, "label": "Review Physics", "target_count": 25},
        ]
        + [
            {"kind": "free_text", "label": f"Extra task {i}", "target_id": None}
            for i in range(60)
        ],
    }

    with patch.object(service, "_complete_json", new=AsyncMock(return_value=mock_llm_json)):
        draft = await service.generate_study_plan_draft("I need to study math and physics", fake_catalog)

    assert draft["title"] == "My Big Exam Prep"
    assert draft["exam_date"] == "2026-12-15"
    assert len(draft["items"]) <= 50

    item0 = draft["items"][0]
    assert item0["kind"] == "test"
    assert item0["target_id"] == 10
    assert item0["due_date"] == "2026-12-01"

    item1 = draft["items"][1]
    assert item1["kind"] == "free_text"
    assert item1["target_id"] is None
    assert item1["due_date"] is None

    item2 = draft["items"][2]
    assert item2["kind"] == "flashcards"
    assert item2["target_id"] == 20
    assert item2["target_count"] == 25


# ---------------------------------------------------------------- Gating & HTTP tests

async def test_non_beta_user_forbidden(db_session_maker):
    async with db_session_maker() as session:
        user = await _create_user(session, "regular@test.com", is_beta=False, is_admin=False)
        from src.dependencies import get_current_user

        async def override_get_current_user():
            return user

        app.dependency_overrides[get_current_user] = override_get_current_user

        async with AsyncClient(app=app, base_url="http://test") as ac:
            r = await ac.get("/study-plans")
            assert r.status_code == 403

            r_pinned = await ac.get("/study-plans/pinned")
            assert r_pinned.status_code == 403

            r_draft = await ac.post("/study-plans/draft", json={"text": "Study plan"})
            assert r_draft.status_code == 403

            r_dash = await ac.patch(
                "/users/me/dashboard-widgets",
                json={"widgets": ["review_these", "study_plan"]},
            )
            assert r_dash.status_code == 403

        app.dependency_overrides.clear()


async def test_beta_user_endpoints_and_widgets(db_session_maker):
    async with db_session_maker() as session:
        user = await _create_user(session, "beta@test.com", is_beta=True, is_admin=False)
        from src.database import get_session
        from src.dependencies import get_current_user

        async def override_get_current_user():
            return user

        async def override_get_session():
            yield session

        app.dependency_overrides[get_current_user] = override_get_current_user
        app.dependency_overrides[get_session] = override_get_session

        async with AsyncClient(app=app, base_url="http://test") as ac:
            r = await ac.get("/study-plans")
            assert r.status_code == 200
            assert r.json() == []

            create_payload = {
                "title": "Semester Plan",
                "exam_date": "2026-12-20",
                "is_pinned": True,
                "items": [
                    {"kind": "free_text", "label": "Read chapter 1", "due_date": "2026-11-15"}
                ],
            }
            r_create = await ac.post("/study-plans", json=create_payload)
            assert r_create.status_code == 201
            data = r_create.json()
            assert data["title"] == "Semester Plan"
            assert len(data["items"]) == 1
            item_id = data["items"][0]["id"]

            r_toggle = await ac.patch(f"/study-plans/items/{item_id}", json={"done": True})
            assert r_toggle.status_code == 200
            assert r_toggle.json()["done"] is True

            r_dash = await ac.patch(
                "/users/me/dashboard-widgets",
                json={"widgets": ["review_these", "study_plan"]},
            )
            assert r_dash.status_code == 200
            assert r_dash.json()["dashboard_widgets"] == ["review_these", "study_plan"]

            r_bad = await ac.patch(
                "/users/me/dashboard-widgets",
                json={"widgets": ["review_these", "review_these"]},
            )
            assert r_bad.status_code == 422

        app.dependency_overrides.clear()


# ---------------------------------------------------------------- MCP plan tools tests

async def test_mcp_plan_tools_gating_and_crud(db_session_maker):
    async with db_session_maker() as session:
        reg_user = await _create_user(session, "reg_mcp@test.com", is_beta=False)
        beta_user = await _create_user(session, "beta_mcp@test.com", is_beta=True)

        reg_ctx = McpContext(user=reg_user, session=session)
        with pytest.raises(ToolInputError):
            await list_study_plans(reg_ctx, ListStudyPlansArgs())

        beta_ctx = McpContext(user=beta_user, session=session)
        created = await create_study_plan(
            beta_ctx,
            CreateStudyPlanArgs(
                title="MCP Plan",
                items=[{"kind": "free_text", "label": "Read MCP docs"}],
            ),
        )
        plan_id = created["plan"]["id"]
        item_id = created["plan"]["items"][0]["id"]

        listed = await list_study_plans(beta_ctx, ListStudyPlansArgs())
        assert len(listed["plans"]) == 1
        assert listed["plans"][0]["title"] == "MCP Plan"

        toggled = await set_plan_item_done(beta_ctx, SetPlanItemDoneArgs(item_id=item_id, done=True))
        assert toggled["item"]["done"] is True

        with pytest.raises(ToolInputError):
            await delete_study_plan(beta_ctx, DeleteStudyPlanArgs(plan_id=plan_id, confirm=False))

        deleted = await delete_study_plan(beta_ctx, DeleteStudyPlanArgs(plan_id=plan_id, confirm=True))
        assert deleted["deleted_plan_id"] == plan_id


async def test_leetcode_solved_without_timestamp_does_not_tick(db_session_maker):
    from src.models.lc_sync import LCCustomProblem, LCProgress

    async with db_session_maker() as session:
        user = await _create_user(session, "lc@test.com")
        problem = LCCustomProblem(user_id=user.id, slug="two-sum-x", title="Two Sum X")
        session.add(problem)
        await session.commit()
        session.add(LCProgress(user_id=user.id, problem_slug="two-sum-x", done=True, solved_at=None))
        await session.commit()

        plan = await StudyPlanService().create_plan(
            user.id,
            StudyPlanCreateRequest(
                title="LC",
                items=[StudyPlanItemCreate(kind="leetcode", label="Two Sum X", target_id=problem.id)],
            ),
            session,
        )
        assert plan.items[0].done is False


async def test_exam_date_can_be_cleared(db_session_maker):
    async with db_session_maker() as session:
        user = await _create_user(session, "clear@test.com")
        service = StudyPlanService()
        plan = await service.create_plan(
            user.id,
            StudyPlanCreateRequest(title="Final", exam_date=datetime.date(2026, 12, 10)),
            session,
        )
        kept = await service.update_plan(plan.id, user.id, StudyPlanUpdateRequest(title="Finals"), session)
        assert kept.exam_date == datetime.date(2026, 12, 10)
        cleared = await service.update_plan(plan.id, user.id, StudyPlanUpdateRequest(exam_date=None), session)
        assert cleared.exam_date is None
        assert cleared.title == "Finals"


async def test_catalog_skips_archived_folders(db_session_maker):
    async with db_session_maker() as session:
        user = await _create_user(session, "archived@test.com")
        live = await _create_folder(session, user.id)
        gone = await _create_folder(session, user.id, "Old class")
        # Set both explicitly: SQLite stores the "false" server_default as text.
        live.is_archived = False
        gone.is_archived = True
        await session.commit()
        await _create_test(session, live.id, "Live exam")
        await _create_test(session, gone.id, "Archived exam")

        catalog = await StudyPlanService().get_catalog(user.id, session)
        assert [t.title for t in catalog.tests] == ["Live exam"]
