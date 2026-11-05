"""Usage hardening for Study Plans, added when the feature left beta (2026-11-05).

- POST /study-plans/draft is charged to the Kojo token budget and holds a Kojo
  in-flight slot, released on success and on failure.
- Study plan rate limits are keyed by account (limiter.user_key), not IP.
- Size caps: items per plan, plans per account, target_count bounds.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pydantic
import pytest
from httpx import AsyncClient

from src.config import settings
from src.database import get_session
from src.dependencies import get_current_user
from src.limiter import limiter
from src.main import app
from src.models.llm_token_usage import LLMTokenUsage
from src.models.user import User
from src.routes.study_plans import DRAFT_USAGE_FEATURE
from src.schemas.study_plan import (
    MAX_PLAN_ITEMS,
    MAX_TARGET_COUNT,
    StudyPlanCreateRequest,
    StudyPlanItemCreate,
    StudyPlanReplaceItemsRequest,
)
from src.services import study_plan_service
from src.services.auth_service import AuthService
from src.services.llm_service import LLMService
from src.services.mcp_plan_tools import CreateStudyPlanArgs, UpdateStudyPlanItemsArgs
from src.services.quota_service import KOJO_FEATURE_PREFIX
from src.services.study_plan_service import StudyPlanService
from src.utils import kojo_inflight
from src.utils.exceptions import LLMException, ValidationException
from src.utils.usage_context import bind_usage, current_scope


DEVICE = "33333333-3333-4333-8333-333333333333"
DRAFT_OK = {"title": "Plan", "exam_date": None, "items": []}


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch):
    monkeypatch.setattr(settings, "usage_limits_enabled", True)
    monkeypatch.setattr(settings, "kojo_token_limit_per_window", 1000)
    limiter.reset()
    kojo_inflight.reset()
    yield
    limiter.reset()
    kojo_inflight.reset()
    app.dependency_overrides.clear()


async def _user(session, email: str, is_beta: bool = False) -> User:
    user = User(email=email, google_id=f"g_{email}", full_name="T", is_beta=is_beta, is_admin=False)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _as(user: User, session) -> dict[str, str]:
    """Route requests as `user` (with a device id, like the real frontend) and
    return headers carrying a real JWT so limiter.user_key sees the account."""

    async def override_user():
        bind_usage(user.id, device_id=DEVICE)
        return user

    async def override_session():
        yield session

    app.dependency_overrides[get_current_user] = override_user
    app.dependency_overrides[get_session] = override_session
    return {"Authorization": f"Bearer {AuthService().generate_jwt(user.id)}"}


# ---------------------------------------------------------------- Kojo budget

def test_draft_feature_counts_toward_kojo_budget():
    # quota_service._kojo_usage only sums features with this prefix.
    assert DRAFT_USAGE_FEATURE.startswith(KOJO_FEATURE_PREFIX)


async def test_draft_blocked_when_kojo_budget_spent(db_session_maker):
    async with db_session_maker() as session:
        user = await _user(session, "spent@test.com")
        session.add(LLMTokenUsage(user_id=user.id, feature="kojo_chat", provider="groq",
                                  input_tokens=800, output_tokens=200))
        await session.commit()
        headers = _as(user, session)
        llm = AsyncMock(return_value=DRAFT_OK)
        with patch.object(LLMService, "generate_study_plan_draft", llm):
            async with AsyncClient(app=app, base_url="http://test") as ac:
                r = await ac.post("/study-plans/draft", json={"text": "study bio"}, headers=headers)
        assert r.status_code == 429
        assert "Kojo" in r.json()["detail"]
        llm.assert_not_awaited()
        assert kojo_inflight._slots == {}


async def test_draft_is_attributed_to_kojo_and_releases_slot(db_session_maker):
    async with db_session_maker() as session:
        user = await _user(session, "ok@test.com")
        headers = _as(user, session)
        seen = {}

        async def fake_draft(self, **kwargs):
            scope = current_scope()
            seen["feature"] = scope.feature
            seen["device"] = scope.device_id
            seen["slots"] = dict(kojo_inflight._slots)
            return DRAFT_OK

        with patch.object(LLMService, "generate_study_plan_draft", fake_draft):
            async with AsyncClient(app=app, base_url="http://test") as ac:
                r = await ac.post("/study-plans/draft", json={"text": "study bio"}, headers=headers)
        assert r.status_code == 200
        assert seen["feature"] == DRAFT_USAGE_FEATURE
        assert seen["device"] == DEVICE
        assert seen["slots"]  # a slot was held during the AI call
        assert kojo_inflight._slots == {}  # and released after


async def test_draft_releases_slot_when_llm_fails(db_session_maker):
    async with db_session_maker() as session:
        user = await _user(session, "fail@test.com")
        headers = _as(user, session)
        llm = AsyncMock(side_effect=LLMException("all providers down"))
        with patch.object(LLMService, "generate_study_plan_draft", llm):
            async with AsyncClient(app=app, base_url="http://test") as ac:
                r = await ac.post("/study-plans/draft", json={"text": "study bio"}, headers=headers)
        assert r.status_code == 503
        assert kojo_inflight._slots == {}


async def test_beta_user_draft_is_not_budget_gated(db_session_maker):
    async with db_session_maker() as session:
        user = await _user(session, "beta@test.com", is_beta=True)
        session.add(LLMTokenUsage(user_id=user.id, feature="kojo_chat", provider="groq",
                                  input_tokens=5000, output_tokens=5000))
        await session.commit()
        headers = _as(user, session)
        with patch.object(LLMService, "generate_study_plan_draft", AsyncMock(return_value=DRAFT_OK)):
            async with AsyncClient(app=app, base_url="http://test") as ac:
                r = await ac.post("/study-plans/draft", json={"text": "study bio"}, headers=headers)
        assert r.status_code == 200


# ---------------------------------------------------------------- per-account rate limit

async def test_draft_rate_limit_is_per_account(db_session_maker):
    async with db_session_maker() as session:
        first = await _user(session, "first@test.com", is_beta=True)
        second = await _user(session, "second@test.com", is_beta=True)
        with patch.object(LLMService, "generate_study_plan_draft", AsyncMock(return_value=DRAFT_OK)):
            async with AsyncClient(app=app, base_url="http://test") as ac:
                headers = _as(first, session)
                codes = [
                    (await ac.post("/study-plans/draft", json={"text": "x"}, headers=headers)).status_code
                    for _ in range(6)
                ]
                assert codes == [200] * 5 + [429]

                # Same IP, different account: its own bucket.
                headers = _as(second, session)
                r = await ac.post("/study-plans/draft", json={"text": "x"}, headers=headers)
                assert r.status_code == 200


# ---------------------------------------------------------------- size caps

def test_item_list_caps():
    items = [StudyPlanItemCreate(kind="free_text", label=f"t{i}") for i in range(MAX_PLAN_ITEMS + 1)]
    with pytest.raises(pydantic.ValidationError):
        StudyPlanCreateRequest(title="Big", items=items)
    with pytest.raises(pydantic.ValidationError):
        StudyPlanReplaceItemsRequest(items=[i.model_dump() for i in items])
    StudyPlanCreateRequest(title="Ok", items=items[:MAX_PLAN_ITEMS])


def test_target_count_bounds():
    with pytest.raises(pydantic.ValidationError):
        StudyPlanItemCreate(kind="flashcards", label="x", target_count=MAX_TARGET_COUNT + 1)
    with pytest.raises(pydantic.ValidationError):
        StudyPlanItemCreate(kind="flashcards", label="x", target_count=-1)


def test_mcp_args_cap_items():
    too_many = [{"kind": "free_text", "label": f"t{i}"} for i in range(MAX_PLAN_ITEMS + 1)]
    with pytest.raises(pydantic.ValidationError):
        CreateStudyPlanArgs(title="Big", items=too_many)
    with pytest.raises(pydantic.ValidationError):
        UpdateStudyPlanItemsArgs(plan_id=1, items=too_many)


async def test_oversized_create_is_rejected_over_http(db_session_maker):
    async with db_session_maker() as session:
        user = await _user(session, "big@test.com")
        headers = _as(user, session)
        items = [{"kind": "free_text", "label": f"t{i}"} for i in range(MAX_PLAN_ITEMS + 1)]
        async with AsyncClient(app=app, base_url="http://test") as ac:
            r = await ac.post("/study-plans", json={"title": "Big", "items": items}, headers=headers)
        assert r.status_code == 422


async def test_plan_count_cap(db_session_maker, monkeypatch):
    monkeypatch.setattr(study_plan_service, "MAX_PLANS_PER_USER", 2)
    async with db_session_maker() as session:
        user = await _user(session, "many@test.com")
        svc = StudyPlanService()
        for i in range(2):
            await svc.create_plan(user.id, StudyPlanCreateRequest(title=f"P{i}"), session)
        with pytest.raises(ValidationException):
            await svc.create_plan(user.id, StudyPlanCreateRequest(title="P3"), session)


async def test_draft_clamps_model_target_count():
    service = LLMService()
    fake = {"title": "T", "items": [
        {"kind": "flashcards", "target_id": 20, "label": "Cards", "target_count": 10**9},
    ]}
    with patch.object(service, "_complete_json", new=AsyncMock(return_value=fake)):
        draft = await service.generate_study_plan_draft("x", [{"kind": "flashcards", "id": 20, "title": "D"}])
    assert draft["items"][0]["target_count"] == MAX_TARGET_COUNT


# ---------------------------------------------------------------- guests

async def test_guest_blocked_from_study_plans(db_session_maker):
    async with db_session_maker() as session:
        guest = await _user(session, "abc@nosey.guest")
        headers = _as(guest, session)
        llm = AsyncMock(return_value=DRAFT_OK)
        with patch.object(LLMService, "generate_study_plan_draft", llm):
            async with AsyncClient(app=app, base_url="http://test") as ac:
                for method, url, body in [
                    ("GET", "/study-plans", None),
                    ("GET", "/study-plans/pinned", None),
                    ("GET", "/study-plans/catalog", None),
                    ("POST", "/study-plans/draft", {"text": "study bio"}),
                    ("POST", "/study-plans", {"title": "P", "items": []}),
                ]:
                    r = await ac.request(method, url, json=body, headers=headers)
                    assert r.status_code == 403, (method, url, r.status_code)

                r = await ac.patch("/users/me/dashboard-widgets",
                                   json={"widgets": ["review_these", "study_plan"]}, headers=headers)
                assert r.status_code == 403
                # Widgets without the plan are still fine.
                r = await ac.patch("/users/me/dashboard-widgets",
                                   json={"widgets": ["weak_spots", "review_these"]}, headers=headers)
                assert r.status_code == 200
        llm.assert_not_awaited()
