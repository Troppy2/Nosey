"""Per-task LLM hints: may a call think, and is its output long?

Thinking (hidden reasoning tokens) is what makes a model get computed answers
right, and it is also slow and token-hungry. Measured on NVIDIA Nemotron 3.5
Lightning with 8 STAT problems (2026-11-10): thinking off 0/8 correct in 1s,
a 1024-token thinking budget 4/8 in ~12s, unbounded thinking 8/8 in 108s. So:

- Write fast, check carefully. Bulk generation runs with thinking OFF:
  tests, practice sets, modules, episodes, coding problems, flashcards, Kojo.
  Thinking made it worse there: a 10 MCQ + 5 FRQ test took 23s off (15/15)
  but 116s on and came back short and unparseable; a module took 16s off with
  a full narration but timed out at 180s on.
- Thinking is ON (`@_thinks`) where the model judges one answer at a time:
  MCQ answer verification (which re-derives and repairs every generated key),
  grading and solving. Deriving 10 STAT answers: off 15s 7/10, on 33s 10/10.
  The budget is the cutoff: when it runs out the model stops thinking and
  answers. A call that still overruns the request timeout fails and the normal
  provider chain moves on to the next provider (no extra retry loop).

Long output (`long_output()`): bulk generators (tests, practice sets, modules,
episodes, coding problems) put Groq ahead of NVIDIA in the auto chain. NVIDIA's
free tier handles short calls well but often fails or times out on long JSON
(2026-11-10: a module run returned broken JSON at 24s; bigger NVIDIA models hit
the 180s timeout even with thinking off), and every miss delays the fallback.

Only providers whose thinking can be switched per request read this (NVIDIA).
Groq, MiniMax and Gemini keep their fixed low-effort settings; Claude Haiku
does not think. A ContextVar, like usage_context, so LLMService stays
stateless: set it in a plain coroutine (an entry method), never inside an
async generator, where the reset would run in a different context.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

_thinking: ContextVar[bool] = ContextVar("llm_thinking", default=False)


def thinking_enabled() -> bool:
    return _thinking.get()


@contextmanager
def thinking(enabled: bool = True) -> Iterator[None]:
    """Let every LLM call made inside this block think (or forbid it)."""
    token = _thinking.set(enabled)
    try:
        yield
    finally:
        _thinking.reset(token)


_long_output: ContextVar[bool] = ContextVar("llm_long_output", default=False)


def long_output_enabled() -> bool:
    return _long_output.get()


@contextmanager
def long_output() -> Iterator[None]:
    """Calls in this block write long output: route them to a provider that
    handles it reliably first (see _candidate_providers)."""
    token = _long_output.set(True)
    try:
        yield
    finally:
        _long_output.reset(token)
