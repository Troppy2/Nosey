"""Per-request attribution for LLM token usage.

LLMService is stateless and session-free, so the provider leaf functions cannot
know which user or feature they are serving. Routes bind that here, in a
ContextVar, and the leaves call record_llm_usage() with the token counts the
provider returned. ContextVars are copied into asyncio.create_task and
asyncio.gather children, so background test generation and sharded MCQ
verification inherit the binding automatically.

get_current_user binds the user id for every authenticated request; routes that
are limited (tests, flashcards, Kojo) also bind a feature name.
"""
from __future__ import annotations

import asyncio
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Callable, Optional

from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class UsageScope:
    user_id: Optional[int]
    feature: Optional[str]
    # Browser-generated device id (X-Device-Id header), only set for
    # usage-limited users. Lets several accounts on one device share limits.
    device_id: Optional[str] = None


_scope: ContextVar[Optional[UsageScope]] = ContextVar("llm_usage_scope", default=None)

# Strong references to in-flight writes so they are not garbage collected
# mid-insert (same pattern as _spawn_generation in routes/tests.py). Writes are
# scheduled as tasks so a cancelled stream (client disconnect) still records.
_pending_writes: set[asyncio.Task] = set()


_KEEP = object()


def bind_usage(user_id: Optional[int], feature: Optional[str] = None, device_id: Any = _KEEP) -> None:
    """Attribute every LLM call made from this context onward.

    device_id defaults to whatever is already bound (get_current_user binds it
    from the request header), so routes can re-bind the feature without
    dropping it.
    """
    if device_id is _KEEP:
        current = _scope.get()
        device_id = current.device_id if current else None
    _scope.set(UsageScope(user_id=user_id, feature=feature, device_id=device_id))


def current_device_id() -> Optional[str]:
    scope = _scope.get()
    return scope.device_id if scope else None


def current_scope() -> Optional[UsageScope]:
    return _scope.get()


def _get_session_maker() -> Callable[[], Any]:
    # Imported lazily: src.database imports every model at import time.
    from src.database import async_session_maker

    return async_session_maker


async def _write(scope: UsageScope, provider: str, model: Optional[str], input_tokens: int,
                 output_tokens: int, estimated: bool, success: bool) -> None:
    from src.models.llm_token_usage import LLMTokenUsage

    try:
        async with _get_session_maker()() as session:
            session.add(LLMTokenUsage(
                user_id=scope.user_id,
                feature=scope.feature,
                device_id=scope.device_id,
                provider=provider,
                model=(model or None) and model[:100],
                input_tokens=max(0, int(input_tokens or 0)),
                output_tokens=max(0, int(output_tokens or 0)),
                estimated=estimated,
                success=success,
            ))
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - usage tracking must never break a request
        logger.warning("llm usage write failed: %s", exc)


def record_llm_usage(
    provider: str,
    model: Optional[str],
    input_tokens: Optional[int],
    output_tokens: Optional[int],
    *,
    estimated: bool = False,
    success: bool = True,
) -> None:
    """Record one provider call. Never raises and never blocks the caller.

    Calls made outside any bound scope (scripts, unit tests driving LLMService
    directly) are skipped: there is no user to attribute them to.
    """
    try:
        scope = _scope.get()
        if scope is None or (scope.user_id is None and scope.feature is None):
            return
        task = asyncio.get_running_loop().create_task(
            _write(scope, provider, model, input_tokens or 0, output_tokens or 0, estimated, success)
        )
        _pending_writes.add(task)
        task.add_done_callback(_pending_writes.discard)
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm usage record failed: %s", exc)


def record_parsed_usage(provider: str, model: Optional[str], usage: Optional[tuple[int, int]]) -> None:
    """Record a non-streamed call from a parsed usage tuple (see usage_from_*)."""
    if usage is None:
        logger.debug("no usage block in %s response; call not recorded", provider)
        return
    record_llm_usage(provider, model, usage[0], usage[1])


async def drain_pending_writes() -> None:
    """Await all scheduled usage writes. Used by tests."""
    while _pending_writes:
        await asyncio.gather(*list(_pending_writes), return_exceptions=True)


# ---------------------------------------------------------------------------
# Provider response parsers. Each returns (input_tokens, output_tokens) or None
# when the payload carries no usage block.
# ---------------------------------------------------------------------------

def usage_from_openai(payload: Any) -> Optional[tuple[int, int]]:
    """Groq (OpenAI-compatible): usage.prompt_tokens / completion_tokens.

    Streaming chunks may carry it as `usage` (stream_options.include_usage) or
    as `x_groq.usage` on the final chunk.
    """
    if not isinstance(payload, dict):
        return None
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        x_groq = payload.get("x_groq")
        usage = x_groq.get("usage") if isinstance(x_groq, dict) else None
    if not isinstance(usage, dict):
        return None
    return int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)


def usage_from_anthropic(payload: Any) -> Optional[tuple[int, int]]:
    """Anthropic Messages: usage.input_tokens (+ cache tokens) / output_tokens."""
    if not isinstance(payload, dict):
        return None
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None
    input_tokens = (
        int(usage.get("input_tokens") or 0)
        + int(usage.get("cache_creation_input_tokens") or 0)
        + int(usage.get("cache_read_input_tokens") or 0)
    )
    return input_tokens, int(usage.get("output_tokens") or 0)


def usage_from_gemini(payload: Any) -> Optional[tuple[int, int]]:
    """Gemini: usageMetadata.promptTokenCount / candidatesTokenCount (+ thoughts)."""
    if not isinstance(payload, dict):
        return None
    meta = payload.get("usageMetadata")
    if not isinstance(meta, dict):
        return None
    output_tokens = int(meta.get("candidatesTokenCount") or 0) + int(meta.get("thoughtsTokenCount") or 0)
    return int(meta.get("promptTokenCount") or 0), output_tokens


def usage_from_ollama(payload: Any) -> Optional[tuple[int, int]]:
    """Ollama /api/generate: prompt_eval_count (absent on prompt-cache hits) / eval_count."""
    if not isinstance(payload, dict) or "eval_count" not in payload:
        return None
    return int(payload.get("prompt_eval_count") or 0), int(payload.get("eval_count") or 0)


def estimate_tokens(text: str) -> int:
    """Rough fallback when a provider returned no usage (about 4 chars per token)."""
    return max(0, len(text or "") // 4)


class StreamUsage:
    """Accumulates usage for one streamed call and records it exactly once.

    Streams can end early (the consumer breaks once it has enough questions, or
    the client disconnects), in which case the final usage chunk never arrives.
    finish() then falls back to a chars/4 estimate of prompt and output.
    """

    def __init__(self, provider: str, model: Optional[str], prompt_text: str) -> None:
        self.provider = provider
        self.model = model
        self.prompt_text = prompt_text
        self.input_tokens: Optional[int] = None
        self.output_tokens: Optional[int] = None
        self.output_chars = 0
        self._done = False

    def add_text(self, text: str) -> None:
        self.output_chars += len(text or "")

    def set_input(self, tokens: int) -> None:
        self.input_tokens = tokens

    def set_output(self, tokens: int) -> None:
        self.output_tokens = tokens

    def set_both(self, usage: Optional[tuple[int, int]]) -> None:
        if usage is None:
            return
        self.input_tokens, self.output_tokens = usage

    def finish(self, success: bool = True) -> None:
        if self._done:
            return
        self._done = True
        if not success and self.output_chars == 0 and self.input_tokens is None and self.output_tokens is None:
            # Failed before the provider produced anything (HTTP 429/5xx on
            # stream start): nothing was generated, so nothing to bill.
            return
        estimated =self.input_tokens is None or self.output_tokens is None
        input_tokens = self.input_tokens if self.input_tokens is not None else estimate_tokens(self.prompt_text)
        output_tokens = self.output_tokens if self.output_tokens is not None else self.output_chars // 4
        record_llm_usage(self.provider, self.model, input_tokens, output_tokens,
                         estimated=estimated, success=success)
