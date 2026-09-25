"""Admin token analytics: calendar-week bucketing, breakdowns and cost."""
from __future__ import annotations

from datetime import datetime

from src.config import settings
from src.models.llm_token_usage import LLMTokenUsage
from src.services.token_analytics_service import (
    DEFAULT_PRICING,
    TREND_WEEKS,
    TokenAnalyticsService,
    price_for,
)

# Wednesday 2026-09-23 12:00 UTC. Its week starts Monday 2026-09-21.
NOW = datetime(2026, 9, 23, 12, 0)


def _row(when, provider="groq", model="llama-3.3-70b-versatile", feature="kojo_chat", tin=1000, tout=500, estimated=False):
    return LLMTokenUsage(user_id=1, feature=feature, provider=provider, model=model,
                         input_tokens=tin, output_tokens=tout, estimated=estimated, created_at=when)


def test_price_lookup_prefers_exact_then_longest_prefix() -> None:
    assert price_for(DEFAULT_PRICING, "groq", "llama-3.1-8b-instant") == (0.05, 0.08)
    assert price_for(DEFAULT_PRICING, "claude", "claude-haiku-4-5-20251001") == (1.00, 5.00)
    assert price_for(DEFAULT_PRICING, "gemini", "gemini-2.0-flash-lite-001") == (0.075, 0.30)
    assert price_for(DEFAULT_PRICING, "gemini", "gemini-2.0-flash") == (0.10, 0.40)
    assert price_for(DEFAULT_PRICING, "ollama", "anything") == (0.0, 0.0)
    assert price_for(DEFAULT_PRICING, "groq", "unknown-model") is None


async def test_weekly_report_buckets_and_breakdowns(db_session_maker) -> None:
    async with db_session_maker() as session:
        session.add_all([
            _row(datetime(2026, 9, 21, 9)),                                   # this week (Mon)
            _row(datetime(2026, 9, 23, 8), provider="ollama", model="m",      # this week, free
                 feature="test_generation", tin=4000, tout=2000),
            _row(datetime(2026, 9, 20, 23), tin=100, tout=100),               # last week (Sun), still within 7 days
            _row(datetime(2026, 9, 10, 9), tin=10, tout=10),                  # two weeks ago
            _row(datetime(2026, 9, 23, 9), provider="groq", model="mystery",  # unpriced
                 feature="kojo_chat", tin=1, tout=1, estimated=True),
            _row(datetime(2025, 1, 1, 9)),                                    # outside the 12-week trend
        ])
        await session.commit()
        report = await TokenAnalyticsService().weekly_report(session, now=NOW)

    assert len(report.weeks) == TREND_WEEKS
    assert report.weeks[-1]["week_start"] == "2026-09-21"
    assert report.weeks[-1]["total_tokens"] == 1500 + 6000 + 2
    assert report.weeks[-2]["total_tokens"] == 200
    assert report.weeks[-3]["total_tokens"] == 20

    assert report.this_week["week_start"] == "2026-09-21"
    assert report.this_week["unpriced_calls"] == 1
    assert report.this_week["estimated_calls"] == 1
    # groq 70b: 1000 in * 0.59 + 500 out * 0.79 per 1M; ollama free.
    assert abs(report.this_week["cost_usd"] - (1000 * 0.59 + 500 * 0.79) / 1_000_000) < 1e-4

    assert report.last_7_days["total_tokens"] == 1500 + 6000 + 2 + 200

    features = {row["feature"]: row for row in report.by_feature}
    assert features["test_generation"]["total_tokens"] == 6000
    assert features["kojo_chat"]["total_tokens"] == 1502
    assert report.by_feature[0]["feature"] == "test_generation"  # ranked by tokens

    providers = {row["provider"]: row for row in report.by_provider}
    assert providers["ollama"]["cost_usd"] == 0
    assert providers["groq"]["calls"] == 2


async def test_pricing_override_from_env(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_pricing_json", '{"ollama:*": [1.0, 1.0]}')
    async with db_session_maker() as session:
        session.add(_row(datetime(2026, 9, 22, 9), provider="ollama", model="m", tin=1_000_000, tout=0))
        await session.commit()
        report = await TokenAnalyticsService().weekly_report(session, now=NOW)
    assert report.this_week["cost_usd"] == 1.0
