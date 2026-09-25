"""Admin token analytics over llm_token_usage (real provider token counts).

Weeks are calendar weeks, Monday to Sunday, in UTC. Cost is an ESTIMATE from a
per-model price table (USD per 1M tokens); Ollama is treated as free. Prices
drift, so the table can be overridden without a deploy via LLM_PRICING_JSON:

    {"groq:llama-3.3-70b-versatile": [0.59, 0.79], "claude:*": [1.0, 5.0]}

Keys are "provider:model" (exact), "provider:model-prefix*", or "provider:*".

Stateless: every method takes the session.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.llm_token_usage import LLMTokenUsage
from src.utils.logger import get_logger
from src.utils.time import utcnow_naive

logger = get_logger(__name__)

TREND_WEEKS = 12

# USD per 1M tokens: (input, output). Estimates; override with LLM_PRICING_JSON.
DEFAULT_PRICING: dict[str, tuple[float, float]] = {
    "groq:llama-3.3-70b-versatile": (0.59, 0.79),
    "groq:llama-3.1-8b-instant": (0.05, 0.08),
    "claude:claude-haiku-4-5*": (1.00, 5.00),
    "claude:claude-sonnet*": (3.00, 15.00),
    "gemini:gemini-2.0-flash-lite*": (0.075, 0.30),
    "gemini:gemini-2.0-flash*": (0.10, 0.40),
    "gemini:gemini-2.5-flash*": (0.30, 2.50),
    "ollama:*": (0.0, 0.0),
}


def _load_pricing() -> dict[str, tuple[float, float]]:
    pricing = dict(DEFAULT_PRICING)
    raw = settings.llm_pricing_json
    if raw:
        try:
            for key, value in json.loads(raw).items():
                pricing[str(key)] = (float(value[0]), float(value[1]))
        except (ValueError, TypeError, IndexError, AttributeError) as exc:
            logger.warning("LLM_PRICING_JSON ignored (invalid): %s", exc)
    return pricing


def price_for(pricing: dict[str, tuple[float, float]], provider: str, model: Optional[str]) -> Optional[tuple[float, float]]:
    """Exact provider:model, then the longest matching prefix*, then provider:*."""
    model = model or ""
    exact = pricing.get(f"{provider}:{model}")
    if exact is not None:
        return exact
    best: Optional[tuple[int, tuple[float, float]]] = None
    for key, value in pricing.items():
        if not key.endswith("*") or not key.startswith(f"{provider}:"):
            continue
        prefix = key[len(provider) + 1:-1]
        if model.startswith(prefix) and (best is None or len(prefix) > best[0]):
            best = (len(prefix), value)
    return best[1] if best else None


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


@dataclass
class Bucket:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    calls: int = 0
    estimated_calls: int = 0
    unpriced_calls: int = 0

    def add(self, input_tokens: int, output_tokens: int, cost: Optional[float], calls: int, estimated: int) -> None:
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.calls += calls
        self.estimated_calls += estimated
        if cost is None:
            self.unpriced_calls += calls
        else:
            self.cost_usd += cost

    def as_dict(self) -> dict:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
            "cost_usd": round(self.cost_usd, 4),
            "calls": self.calls,
            "estimated_calls": self.estimated_calls,
            "unpriced_calls": self.unpriced_calls,
        }


@dataclass
class TokenReport:
    weeks: list[dict] = field(default_factory=list)
    this_week: dict = field(default_factory=dict)
    last_7_days: dict = field(default_factory=dict)
    by_feature: list[dict] = field(default_factory=list)
    by_provider: list[dict] = field(default_factory=list)


class TokenAnalyticsService:
    async def weekly_report(self, session: AsyncSession, now: Optional[datetime] = None) -> TokenReport:
        now = now or utcnow_naive()
        today = now.date()
        current_week = week_start(today)
        first_week = current_week - timedelta(weeks=TREND_WEEKS - 1)

        # One grouped query per (day, provider, model, feature); weeks, costs
        # and breakdowns are folded in Python so this stays portable (SQLite
        # tests, Postgres prod) and the row count stays small (84 days x a few
        # providers x a handful of features).
        day_col = func.date(LLMTokenUsage.created_at)
        rows = (await session.execute(
            select(
                day_col,
                LLMTokenUsage.provider,
                LLMTokenUsage.model,
                LLMTokenUsage.feature,
                func.coalesce(func.sum(LLMTokenUsage.input_tokens), 0),
                func.coalesce(func.sum(LLMTokenUsage.output_tokens), 0),
                func.count(),
                func.coalesce(func.sum(case((LLMTokenUsage.estimated.is_(True), 1), else_=0)), 0),
            )
            .where(LLMTokenUsage.created_at >= datetime.combine(first_week, datetime.min.time()))
            .group_by(day_col, LLMTokenUsage.provider, LLMTokenUsage.model, LLMTokenUsage.feature)
        )).all()

        pricing = _load_pricing()
        weeks: dict[date, Bucket] = {first_week + timedelta(weeks=i): Bucket() for i in range(TREND_WEEKS)}
        this_week = Bucket()
        last_7 = Bucket()
        by_feature: dict[str, Bucket] = {}
        by_provider: dict[str, Bucket] = {}

        for day_value, provider, model, feature, in_tok, out_tok, calls, estimated in rows:
            day = day_value if isinstance(day_value, date) else date.fromisoformat(str(day_value)[:10])
            in_tok, out_tok, calls, estimated = int(in_tok), int(out_tok), int(calls), int(estimated)
            price = price_for(pricing, provider, model)
            cost = None if price is None else (in_tok * price[0] + out_tok * price[1]) / 1_000_000

            bucket = weeks.get(week_start(day))
            if bucket is not None:
                bucket.add(in_tok, out_tok, cost, calls, estimated)
            if week_start(day) == current_week:
                this_week.add(in_tok, out_tok, cost, calls, estimated)
                by_feature.setdefault(feature or "other", Bucket()).add(in_tok, out_tok, cost, calls, estimated)
                by_provider.setdefault(provider, Bucket()).add(in_tok, out_tok, cost, calls, estimated)
            # Day granularity: "last 7 days" = today plus the 6 days before it.
            if 0 <= (today - day).days < 7:
                last_7.add(in_tok, out_tok, cost, calls, estimated)

        def ranked(buckets: dict[str, Bucket], key: str) -> list[dict]:
            items = [{key: name, **bucket.as_dict()} for name, bucket in buckets.items()]
            return sorted(items, key=lambda item: item["total_tokens"], reverse=True)

        return TokenReport(
            weeks=[{"week_start": start.isoformat(), **bucket.as_dict()} for start, bucket in sorted(weeks.items())],
            this_week={"week_start": current_week.isoformat(), **this_week.as_dict()},
            last_7_days=last_7.as_dict(),
            by_feature=ranked(by_feature, "feature"),
            by_provider=ranked(by_provider, "provider"),
        )
