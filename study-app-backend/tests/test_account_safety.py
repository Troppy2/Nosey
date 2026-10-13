"""Bans, re-sign-up cooldown and moderation of typed input (GH #172, GH #173)."""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from src.models.account_safety import AccountTombstone, ContentFlag
from src.models.usage_event import UsageEvent
from src.models.user import User
from src.repositories.user_repository import UserRepository
from src.services import account_safety_service as safety
from src.services.auth_service import AuthService
from src.utils.exceptions import ForbiddenException, LLMException
from src.utils import safety_notice
from src.utils.safety_notice import SAFETY_HEADER, SafetyNoticeMiddleware, set_safety_notice
from src.utils.time import utcnow_naive


def _result(**hits: bool) -> dict:
    return {
        "flagged": any(hits.values()),
        "categories": dict(hits),
        "category_scores": {name: 0.9 for name in hits},
    }


@pytest.fixture
def maker(db_session_maker, monkeypatch):
    # The service writes flags/bans in its own session; point it at the test DB.
    monkeypatch.setattr(safety, "async_session_maker", db_session_maker)
    monkeypatch.setattr(safety.settings, "openai_api_key", "test-key")
    return db_session_maker


async def _user(maker, **fields) -> User:
    async with maker() as session:
        user = User(email=f"{fields.get('google_id', 'g1')}@x.com", google_id="g1", **fields)
        session.add(user)
        await session.commit()
        return user


def _moderation_returns(monkeypatch, result: dict | Exception) -> list[list[str]]:
    calls: list[list[str]] = []

    async def fake(self, texts):
        calls.append(texts)
        if isinstance(result, Exception):
            raise result
        return [result for _ in texts]

    monkeypatch.setattr("src.services.llm_service.LLMService.moderate", fake)
    return calls


# ── classify ─────────────────────────────────────────────────────────────────


def test_classify_severities():
    assert safety.classify(_result(**{"sexual/minors": True}))[0] == "minors"
    assert safety.classify(_result(**{"illicit/violent": True}))[0] == "harmful"
    assert safety.classify(_result(sexual=True, violence=True))[0] == "harmful"
    assert safety.classify(_result(**{"self-harm/intent": True}))[0] == "self_harm"
    # Broad categories alone (history, health, literature) are not acted on.
    assert safety.classify(_result(violence=True))[0] is None
    assert safety.classify(_result(sexual=True))[0] is None
    assert safety.classify(_result(hate=True, harassment=True))[0] is None
    # Most severe wins.
    assert safety.classify(_result(**{"sexual/minors": True, "self-harm": True}))[0] == "minors"


# ── screen_user_input ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_minors_hit_bans_flags_and_tombstones(maker, monkeypatch):
    user = await _user(maker)
    _moderation_returns(monkeypatch, _result(**{"sexual/minors": True}))

    with pytest.raises(HTTPException) as caught:
        await safety.screen_user_input(user, "kojo_chat", "bad text")
    assert caught.value.status_code == 403
    assert caught.value.headers[SAFETY_HEADER] == "suspended"

    async with maker() as session:
        fresh = await session.get(User, user.id)
        assert fresh.banned_at is not None and fresh.banned_by is None
        flag = (await session.scalars(select(ContentFlag))).one()
        assert flag.severity == "minors" and flag.action == "auto_banned"
        tomb = (await session.scalars(select(AccountTombstone))).one()
        assert tomb.reason == "banned" and tomb.expires_at is None
        # Only a keyed hash is kept, never the raw Google id.
        assert tomb.subject_hash != "g1" and len(tomb.subject_hash) == 64


@pytest.mark.asyncio
async def test_harmful_hit_refuses_and_flags_without_ban(maker, monkeypatch):
    user = await _user(maker)
    _moderation_returns(monkeypatch, _result(**{"illicit/violent": True}))

    with pytest.raises(HTTPException) as caught:
        await safety.screen_user_input(user, "kojo_chat", "how do I build a weapon")
    assert caught.value.status_code == 400
    assert caught.value.headers[SAFETY_HEADER] == "warning"
    async with maker() as session:
        assert (await session.get(User, user.id)).banned_at is None
        assert (await session.scalars(select(ContentFlag))).one().severity == "harmful"


@pytest.mark.asyncio
async def test_harmful_in_test_answers_is_flagged_but_not_refused(maker, monkeypatch):
    user = await _user(maker)
    _moderation_returns(monkeypatch, _result(**{"harassment/threatening": True}))
    await safety.screen_user_input(user, "test_answers", "answer", block_harmful=False)
    holder: dict[str, str] = {}
    token = safety_notice._notice.set(holder)
    try:
        await safety.screen_user_input(user, "test_answers", "answer", block_harmful=False)
    finally:
        safety_notice._notice.reset(token)
    assert holder["kind"] == "warning-allowed"
    async with maker() as session:
        assert {f.severity for f in (await session.scalars(select(ContentFlag))).all()} == {"harmful"}


@pytest.mark.asyncio
async def test_long_input_is_screened_in_full(maker, monkeypatch):
    """Harmless padding must not push content past the check (no truncation)."""
    user = await _user(maker)
    seen: list[str] = []

    async def fake(self, texts):
        seen.extend(texts)
        return [_result(**{"illicit/violent": "BAD" in t}) for t in texts]

    monkeypatch.setattr("src.services.llm_service.LLMService.moderate", fake)
    padding = "harmless study notes " * 10000  # ~210k chars, 27 chunks
    with pytest.raises(HTTPException):
        await safety.screen_user_input(user, "learning_lesson_edit", padding + "BAD")
    assert "".join(seen).endswith("BAD")


@pytest.mark.asyncio
async def test_self_harm_passes_and_flags(maker, monkeypatch):
    user = await _user(maker)
    _moderation_returns(monkeypatch, _result(**{"self-harm/intent": True}))
    await safety.screen_user_input(user, "kojo_chat", "I want to hurt myself")
    async with maker() as session:
        flag = (await session.scalars(select(ContentFlag))).one()
        assert flag.severity == "self_harm" and flag.action is None


@pytest.mark.asyncio
async def test_admin_is_never_auto_banned(maker, monkeypatch):
    user = await _user(maker, is_admin=True)
    _moderation_returns(monkeypatch, _result(**{"sexual/minors": True}))
    with pytest.raises(HTTPException) as caught:
        await safety.screen_user_input(user, "kojo_chat", "x")
    assert caught.value.status_code == 400
    async with maker() as session:
        assert (await session.get(User, user.id)).banned_at is None


@pytest.mark.asyncio
async def test_moderation_outage_fails_open_and_is_logged(maker, monkeypatch):
    user = await _user(maker)
    _moderation_returns(monkeypatch, LLMException("down"))
    await safety.screen_user_input(user, "kojo_chat", "hello")
    async with maker() as session:
        event = (await session.scalars(select(UsageEvent))).one()
        assert event.feature == "moderation" and event.success is False


@pytest.mark.asyncio
async def test_clean_and_empty_input(maker, monkeypatch):
    user = await _user(maker)
    calls = _moderation_returns(monkeypatch, _result())
    await safety.screen_user_input(user, "kojo_chat", None, "  ")
    assert calls == []  # nothing typed, no call
    await safety.screen_user_input(user, "kojo_chat", "what is a derivative")
    assert len(calls) == 1
    async with maker() as session:
        assert (await session.scalars(select(ContentFlag))).all() == []


@pytest.mark.asyncio
async def test_no_key_means_moderation_is_off(maker, monkeypatch):
    user = await _user(maker)
    monkeypatch.setattr(safety.settings, "openai_api_key", None)
    calls = _moderation_returns(monkeypatch, _result(**{"sexual/minors": True}))
    await safety.screen_user_input(user, "kojo_chat", "anything")
    assert calls == []


# ── tombstones and sign-in (GH #172) ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_deleted_account_cannot_sign_up_until_cooldown_ends(maker):
    async with maker() as session:
        safety.add_deletion_tombstone(session, "g-deleted")
        await session.commit()
    async with maker() as session:
        repo = UserRepository(session)
        with pytest.raises(ForbiddenException, match="deleted recently"):
            await AuthService._check_account_allowed(session, repo, "g-deleted")
        # A different Google account is unaffected.
        await AuthService._check_account_allowed(session, repo, "g-other")
        # After expiry it is allowed again.
        tomb = (await session.scalars(select(AccountTombstone))).one()
        tomb.expires_at = utcnow_naive() - timedelta(minutes=1)
        await session.commit()
        await AuthService._check_account_allowed(session, repo, "g-deleted")


@pytest.mark.asyncio
async def test_existing_user_signs_in_despite_a_tombstone(maker):
    await _user(maker)
    async with maker() as session:
        safety.add_deletion_tombstone(session, "g1")
        await session.commit()
        await AuthService._check_account_allowed(session, UserRepository(session), "g1")


@pytest.mark.asyncio
async def test_banned_user_and_banned_tombstone_are_refused(maker):
    user = await _user(maker)
    async with maker() as session:
        fresh = await session.get(User, user.id)
        await safety.ban_user(session, fresh, reason="test", banned_by=1)
        await session.commit()
        with pytest.raises(ForbiddenException, match="suspended"):
            await AuthService._check_account_allowed(session, UserRepository(session), "g1")
        # Deleting the banned row does not reopen the door.
        await session.delete(fresh)
        await session.commit()
        with pytest.raises(ForbiddenException, match="suspended"):
            await AuthService._check_account_allowed(session, UserRepository(session), "g1")


@pytest.mark.asyncio
async def test_unban_removes_the_ban_tombstone(maker):
    user = await _user(maker)
    async with maker() as session:
        fresh = await session.get(User, user.id)
        await safety.ban_user(session, fresh, reason="test", banned_by=1)
        await session.commit()
        await safety.unban_user(session, fresh)
        await session.commit()
        assert fresh.banned_at is None
        assert (await session.scalars(select(AccountTombstone))).all() == []


@pytest.mark.asyncio
async def test_admin_cannot_be_banned(maker):
    user = await _user(maker, is_admin=True)
    async with maker() as session:
        with pytest.raises(ValueError):
            await safety.ban_user(session, await session.get(User, user.id), reason="x", banned_by=None)


@pytest.mark.asyncio
async def test_banned_device_blocks_guests(maker):
    user = await _user(maker, last_device_id="11111111-1111-1111-1111-111111111111")
    async with maker() as session:
        assert not await safety.is_device_banned(session, user.last_device_id)
        fresh = await session.get(User, user.id)
        await safety.ban_user(session, fresh, reason="x", banned_by=1)
        await session.commit()
        assert await safety.is_device_banned(session, user.last_device_id)
        assert not await safety.is_device_banned(session, None)


@pytest.mark.asyncio
async def test_purge_drops_expired_tombstones_and_old_unbanned_flags(maker):
    clean = await _user(maker)
    async with maker() as session:
        banned = User(email="b@x.com", google_id="g2", banned_at=utcnow_naive())
        session.add(banned)
        await session.flush()
        old = utcnow_naive() - timedelta(days=400)
        session.add_all([
            ContentFlag(user_id=clean.id, feature="f", severity="harmful", categories="c", excerpt="e", created_at=old),
            ContentFlag(user_id=banned.id, feature="f", severity="minors", categories="c", excerpt="e", created_at=old),
            ContentFlag(user_id=clean.id, feature="f", severity="harmful", categories="c", excerpt="e"),
            AccountTombstone(subject_hash="a" * 64, reason="deleted", expires_at=utcnow_naive() - timedelta(hours=1)),
            AccountTombstone(subject_hash="b" * 64, reason="banned", expires_at=None),
        ])
        await session.commit()
        tombstones, flags = await safety.purge_expired_safety_rows(session)
        await session.commit()
        assert (tombstones, flags) == (1, 1)
        kept = (await session.scalars(select(ContentFlag))).all()
        assert len(kept) == 2  # the banned user's evidence and the recent one


# ── X-Nosey-Safety header ────────────────────────────────────────────────────


def test_safety_notice_header_on_success_and_on_refusal():
    app = FastAPI()
    app.add_middleware(SafetyNoticeMiddleware)

    @app.get("/notice")
    async def notice():
        set_safety_notice("self-harm")
        return {"ok": True}

    @app.get("/plain")
    async def plain():
        return {"ok": True}

    @app.get("/refused")
    async def refused():
        raise HTTPException(status_code=400, detail="no", headers={SAFETY_HEADER: "warning"})

    client = TestClient(app)
    assert client.get("/notice").headers[SAFETY_HEADER] == "self-harm"
    assert SAFETY_HEADER not in client.get("/plain").headers
    assert client.get("/refused").headers[SAFETY_HEADER] == "warning"
