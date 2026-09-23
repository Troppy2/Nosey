"""Usage limits and LLM token tracking.

Real in-memory SQLite (db_session_maker) for the quota queries: the rolling
window, clamping and refunds are SQL behavior a mocked session would hide.
"""
from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest

from src.config import settings
from src.models.llm_token_usage import LLMTokenUsage
from src.models.quota_charge import QuotaCharge
from src.models.user import User
from src.services.quota_service import (
    DeviceIdRequired,
    QuotaExceeded,
    QuotaService,
    is_exempt,
    normalize_device_id,
)
from src.utils import kojo_inflight
from src.utils import usage_context
from src.utils.time import utcnow_naive
from src.utils.usage_context import (
    StreamUsage,
    bind_usage,
    current_scope,
    drain_pending_writes,
    usage_from_anthropic,
    usage_from_gemini,
    usage_from_ollama,
    usage_from_openai,
)


async def _make_user(session, email: str, **kwargs) -> User:
    user = User(email=email, google_id=f"google-{email}", **kwargs)
    session.add(user)
    await session.commit()
    return user


DEVICE_A = "11111111-1111-4111-8111-111111111111"
DEVICE_B = "22222222-2222-4222-8222-222222222222"


@pytest.fixture(autouse=True)
def _device():
    """Every test runs as a request from DEVICE_A unless it re-binds."""
    bind_usage(None, None, device_id=DEVICE_A)
    kojo_inflight.reset()
    yield
    kojo_inflight.reset()


@pytest.fixture(autouse=True)
def _limits(monkeypatch):
    monkeypatch.setattr(settings, "usage_limits_enabled", True)
    monkeypatch.setattr(settings, "usage_window_hours", 5)
    monkeypatch.setattr(settings, "test_limit_per_window", 5)
    monkeypatch.setattr(settings, "flashcard_limit_per_window", 50)
    monkeypatch.setattr(settings, "kojo_token_limit_per_window", 1000)


# ── Exemptions ──────────────────────────────────────────────────────────────

def test_exemptions() -> None:
    # Guests are limited (they were the easiest way around the limits).
    assert not is_exempt(User(email="a@nosey.guest", google_id="g", is_admin=False, is_beta=False))
    assert is_exempt(User(email="a@x.com", google_id="g", is_admin=True))
    assert is_exempt(User(email="a@x.com", google_id="g", is_beta=True))
    assert not is_exempt(User(email="a@x.com", google_id="g", is_admin=False, is_beta=False))


async def test_exempt_user_is_never_charged(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "beta@x.com", is_beta=True)
        for _ in range(10):
            assert await QuotaService().charge_test(session, user) is None
        assert await QuotaService().charge_flashcards(session, user, 50) == (50, None)


async def test_kill_switch_disables_limits(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(settings, "usage_limits_enabled", False)
    async with db_session_maker() as session:
        user = await _make_user(session, "k@x.com")
        for _ in range(10):
            assert await QuotaService().charge_test(session, user) is None


# ── Tests quota ─────────────────────────────────────────────────────────────

async def test_test_limit_blocks_sixth_and_refund_frees_a_slot(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "t@x.com")
        svc = QuotaService()
        ids = [await svc.charge_test(session, user) for _ in range(5)]
        with pytest.raises(QuotaExceeded) as exc_info:
            await svc.charge_test(session, user)
        assert exc_info.value.status_code == 429
        assert "5 of 5" in exc_info.value.detail

        await svc.refund(session, ids[0])
        assert await svc.charge_test(session, user) is not None


async def test_charges_outside_window_do_not_count(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "w@x.com")
        old = utcnow_naive() - timedelta(hours=5, minutes=1)
        for _ in range(5):
            session.add(QuotaCharge(user_id=user.id, feature="test", units=1, created_at=old))
        await session.commit()
        assert await QuotaService().charge_test(session, user) is not None


# ── Flashcards quota ────────────────────────────────────────────────────────

async def test_flashcards_clamp_then_block(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "f@x.com")
        svc = QuotaService()
        assert (await svc.charge_flashcards(session, user, 45))[0] == 45
        allowed, _ = await svc.charge_flashcards(session, user, 10)
        assert allowed == 5
        with pytest.raises(QuotaExceeded):
            await svc.charge_flashcards(session, user, 1)


async def test_flashcard_charge_settles_to_cards_produced(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "s@x.com")
        svc = QuotaService()
        _, charge_id = await svc.charge_flashcards(session, user, 20)
        await svc.settle_charge(session, charge_id, 12)
        status = {s.feature: s for s in await svc.get_status(session, user)}
        assert status["flashcard"].used == 12

        _, charge_id = await svc.charge_flashcards(session, user, 10)
        await svc.settle_charge(session, charge_id, 0)
        status = {s.feature: s for s in await svc.get_status(session, user)}
        assert status["flashcard"].used == 12


# ── Kojo token budget ───────────────────────────────────────────────────────

async def test_kojo_budget_counts_only_kojo_features(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "kj@x.com")
        svc = QuotaService()
        session.add(LLMTokenUsage(user_id=user.id, feature="test_generation", provider="groq",
                                  input_tokens=5000, output_tokens=5000))
        session.add(LLMTokenUsage(user_id=user.id, feature="kojo_chat", provider="groq",
                                  input_tokens=600, output_tokens=300))
        await session.commit()
        (await svc.acquire_kojo(session, user)).release()  # 900 < 1000

        session.add(LLMTokenUsage(user_id=user.id, feature="kojo_general", provider="claude",
                                  input_tokens=50, output_tokens=50))
        await session.commit()
        with pytest.raises(QuotaExceeded) as exc_info:
            await svc.acquire_kojo(session, user)
        assert exc_info.value.status_code == 429

        status = {s.feature: s for s in await svc.get_status(session, user)}
        assert status["kojo"].used == 1000
        assert status["kojo"].resets_at is not None


# ── Usage parsers ───────────────────────────────────────────────────────────

def test_usage_parsers() -> None:
    assert usage_from_openai({"usage": {"prompt_tokens": 10, "completion_tokens": 4}}) == (10, 4)
    assert usage_from_openai({"x_groq": {"usage": {"prompt_tokens": 7, "completion_tokens": 2}}}) == (7, 2)
    assert usage_from_openai({"choices": []}) is None
    assert usage_from_anthropic({"usage": {"input_tokens": 9, "output_tokens": 3,
                                           "cache_read_input_tokens": 1}}) == (10, 3)
    assert usage_from_anthropic(None) is None
    assert usage_from_gemini({"usageMetadata": {"promptTokenCount": 8, "candidatesTokenCount": 5,
                                                "thoughtsTokenCount": 2}}) == (8, 7)
    assert usage_from_ollama({"done": True, "eval_count": 6}) == (0, 6)
    assert usage_from_ollama({"response": "x"}) is None


# ── Recording + attribution ─────────────────────────────────────────────────

async def test_stream_usage_records_real_counts_and_estimates_on_early_close(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(usage_context, "_get_session_maker", lambda: db_session_maker)
    async with db_session_maker() as session:
        user = await _make_user(session, "rec@x.com")

    bind_usage(user.id, "kojo_chat")
    real = StreamUsage("groq", "m", "prompt")
    real.add_text("hello")
    real.set_both((11, 3))
    real.finish()

    early = StreamUsage("claude", "m", "p" * 400)  # consumer broke before usage arrived
    early.add_text("x" * 80)
    early.finish()

    failed = StreamUsage("gemini", "m", "prompt")  # HTTP error before any output
    failed.finish(success=False)

    await drain_pending_writes()
    async with db_session_maker() as session:
        from sqlalchemy import select

        rows = (await session.execute(select(LLMTokenUsage).order_by(LLMTokenUsage.id))).scalars().all()
    assert [(r.provider, r.input_tokens, r.output_tokens, r.estimated, r.feature) for r in rows] == [
        ("groq", 11, 3, False, "kojo_chat"),
        ("claude", 100, 20, True, "kojo_chat"),
    ]


async def test_unbound_calls_are_not_recorded(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(usage_context, "_get_session_maker", lambda: db_session_maker)

    async def run() -> None:
        # Fresh context: no scope bound.
        usage_context._scope.set(None)
        usage_context.record_llm_usage("groq", "m", 5, 5)

    await asyncio.create_task(run())
    await drain_pending_writes()
    async with db_session_maker() as session:
        from sqlalchemy import func, select

        assert await session.scalar(select(func.count()).select_from(LLMTokenUsage)) == 0


async def test_scope_propagates_into_background_tasks() -> None:
    bind_usage(42, "test_generation")
    seen = {}

    async def child() -> None:
        seen["scope"] = current_scope()

    await asyncio.create_task(child())
    assert seen["scope"].user_id == 42
    assert seen["scope"].feature == "test_generation"


# -- Device limits -------------------------------------------------------------

def test_normalize_device_id() -> None:
    assert normalize_device_id(DEVICE_A.upper()) == DEVICE_A
    assert normalize_device_id("not-a-uuid") is None
    assert normalize_device_id("") is None
    assert normalize_device_id(None) is None


async def test_limited_request_without_device_id_is_rejected(db_session_maker) -> None:
    bind_usage(None, None, device_id=None)
    async with db_session_maker() as session:
        user = await _make_user(session, "nodev@x.com")
        with pytest.raises(DeviceIdRequired) as exc_info:
            await QuotaService().charge_test(session, user)
        assert exc_info.value.status_code == 428
        with pytest.raises(DeviceIdRequired):
            await QuotaService().acquire_kojo(session, user)


async def test_second_account_on_same_device_shares_the_test_budget(db_session_maker) -> None:
    async with db_session_maker() as session:
        first = await _make_user(session, "first@x.com")
        second = await _make_user(session, "second@x.com")
        guest = await _make_user(session, "guest_1@nosey.guest")
        svc = QuotaService()
        for _ in range(5):
            await svc.charge_test(session, first)
        with pytest.raises(QuotaExceeded):
            await svc.charge_test(session, second)
        with pytest.raises(QuotaExceeded):
            await svc.charge_test(session, guest)

        # A different device gets its own budget, account budget permitting.
        bind_usage(None, None, device_id=DEVICE_B)
        assert await svc.charge_test(session, second) is not None
        with pytest.raises(QuotaExceeded):
            await svc.charge_test(session, first)  # account bucket still full


async def test_flashcards_clamp_to_device_remainder(db_session_maker) -> None:
    async with db_session_maker() as session:
        first = await _make_user(session, "fa@x.com")
        second = await _make_user(session, "fb@x.com")
        svc = QuotaService()
        await svc.charge_flashcards(session, first, 40)
        allowed, _ = await svc.charge_flashcards(session, second, 30)
        assert allowed == 10


async def test_kojo_budget_is_shared_per_device(db_session_maker) -> None:
    async with db_session_maker() as session:
        first = await _make_user(session, "ka@x.com")
        second = await _make_user(session, "kb@x.com")
        session.add(LLMTokenUsage(user_id=first.id, device_id=DEVICE_A, feature="kojo_chat",
                                  provider="groq", input_tokens=900, output_tokens=200))
        await session.commit()
        with pytest.raises(QuotaExceeded):
            await QuotaService().acquire_kojo(session, second)


async def test_status_reports_the_binding_bucket(db_session_maker) -> None:
    async with db_session_maker() as session:
        first = await _make_user(session, "sa@x.com")
        second = await _make_user(session, "sb@x.com")
        svc = QuotaService()
        for _ in range(3):
            await svc.charge_test(session, first)
        status = {s.feature: s for s in await svc.get_status(session, second)}
        assert status["test"].used == 3


# -- Kojo in-flight cap --------------------------------------------------------

async def test_kojo_inflight_cap_blocks_parallel_bursts(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "burst@x.com")
        other = await _make_user(session, "burst2@x.com")
        svc = QuotaService()
        slots = [await svc.acquire_kojo(session, user) for _ in range(kojo_inflight.MAX_INFLIGHT)]
        with pytest.raises(QuotaExceeded) as exc_info:
            await svc.acquire_kojo(session, user)
        assert "still answering" in exc_info.value.detail
        # A second account on the same device shares the device slots.
        with pytest.raises(QuotaExceeded):
            await svc.acquire_kojo(session, other)

        slots[0].release()
        slots[0].release()  # idempotent
        extra = await svc.acquire_kojo(session, user)
        extra.release()
        slots[1].release()
        assert kojo_inflight._slots == {}


async def test_kojo_slot_released_when_budget_check_fails(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session, "over@x.com")
        session.add(LLMTokenUsage(user_id=user.id, feature="kojo_chat", provider="groq",
                                  input_tokens=1000, output_tokens=0))
        await session.commit()
        with pytest.raises(QuotaExceeded):
            await QuotaService().acquire_kojo(session, user)
        assert kojo_inflight._slots == {}


def test_kojo_inflight_slots_expire(monkeypatch) -> None:
    now = [1000.0]
    monkeypatch.setattr(kojo_inflight.time, "monotonic", lambda: now[0])
    keys = ["u:1"]
    for _ in range(kojo_inflight.MAX_INFLIGHT):
        assert kojo_inflight.try_acquire(keys)
    assert not kojo_inflight.try_acquire(keys)
    now[0] += kojo_inflight.SLOT_TTL_SECONDS + 1  # leaked slots (stream never started)
    assert kojo_inflight.try_acquire(keys)


async def test_exempt_user_skips_device_and_slots(db_session_maker) -> None:
    bind_usage(None, None, device_id=None)
    async with db_session_maker() as session:
        admin = await _make_user(session, "admin@x.com", is_admin=True)
        for _ in range(5):
            slot = await QuotaService().acquire_kojo(session, admin)
        slot.release()
        assert kojo_inflight._slots == {}


# -- Test refund uses the LLM-generated count, not DB rows ----------------------

async def test_test_refund_ignores_deleted_rows(db_session_maker, monkeypatch) -> None:
    """Deleting a test's questions mid-generation must not refund the charge."""
    from src.routes import tests as tests_route

    monkeypatch.setattr(tests_route, "async_session_maker", db_session_maker)
    async with db_session_maker() as session:
        user = await _make_user(session, "refund@x.com")
        charge_id = await QuotaService().charge_test(session, user)

    # Generation produced questions; the user deleted them all (0 rows now).
    await tests_route._settle_test_quota(charge_id, test_id=999, generated=7)
    async with db_session_maker() as session:
        assert (await session.get(QuotaCharge, charge_id)).refunded is False

    # Genuine total failure: nothing came back from the LLM.
    await tests_route._settle_test_quota(charge_id, test_id=999, generated=0)
    async with db_session_maker() as session:
        assert (await session.get(QuotaCharge, charge_id)).refunded is True
