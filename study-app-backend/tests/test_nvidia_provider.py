"""NVIDIA provider (replaced Ollama 2026-11-10) and the per-task thinking switch."""
from __future__ import annotations

import pytest

from src.services import llm_service
from src.services.llm_service import LLMService, _no_think, _nvidia_body, _nvidia_content, _thinks
from src.utils.exceptions import LLMException
from src.utils.reasoning_context import thinking, thinking_enabled


def test_thinking_is_off_by_default(monkeypatch) -> None:
    monkeypatch.setattr("src.services.llm_service.settings.nvidia_reasoning_budget", 2048)
    body = _nvidia_body("hi", model="m", temperature=0.2, max_tokens=1000)
    assert body["chat_template_kwargs"] == {"enable_thinking": False, "thinking": False}
    assert body["max_tokens"] == 1000
    assert body["messages"] == [{"role": "user", "content": "hi"}]


def test_thinking_block_turns_it_on_with_the_budget_on_top(monkeypatch) -> None:
    monkeypatch.setattr("src.services.llm_service.settings.nvidia_reasoning_budget", 2048)
    with thinking():
        body = _nvidia_body("hi", model="m", temperature=0.2, max_tokens=1000, json_mode=True, stream=True)
    assert body["chat_template_kwargs"] == {"enable_thinking": True, "thinking": True, "reasoning_budget": 2048}
    # The budget is added so a long think cannot starve the answer.
    assert body["max_tokens"] == 3048
    assert body["messages"][0]["role"] == "system"
    assert body["stream"] is True and body["stream_options"] == {"include_usage": True}
    assert thinking_enabled() is False  # reset after the block


def test_empty_answer_raises_so_the_chain_moves_on() -> None:
    with pytest.raises(LLMException, match="finish_reason=length"):
        _nvidia_content({"choices": [{"message": {"content": "", "reasoning_content": "..."}, "finish_reason": "length"}]})
    assert _nvidia_content({"choices": [{"message": {"content": " {} "}}]}) == "{}"


async def test_decorators_scope_thinking() -> None:
    seen: list[bool] = []

    @_no_think
    async def recall() -> None:
        seen.append(thinking_enabled())

    @_thinks
    async def grade() -> None:
        seen.append(thinking_enabled())
        await recall()

    await grade()
    assert seen == [True, False]
    assert thinking_enabled() is False


def test_thinks_refuses_async_generators() -> None:
    async def gen():
        yield 1

    with pytest.raises(TypeError):
        _thinks(gen)


@pytest.mark.parametrize("name, thinks", [
    ("generate_test_questions", False),  # bulk: write fast, verification checks keys
    ("derive_mcq_answers", True),
    ("grade_frq_answer", True),
    ("generate_module_content", False),  # prose bundle: thinking timed out and shortened narration
    ("generate_flashcards", False),
    ("call_kojo", False),
    ("generate_module_outline", False),
])
def test_answer_key_work_thinks_and_recall_does_not(name: str, thinks: bool) -> None:
    # The wrapper's own code object still names the decorator that made it
    # (functools.wraps copies __qualname__, not __code__).
    method = getattr(LLMService, name)
    assert ("_thinks" in method.__code__.co_qualname) is thinks


async def test_ollama_preference_falls_back_to_auto(monkeypatch) -> None:
    monkeypatch.setattr(llm_service.settings, "nvidia_api_key", "nv")
    monkeypatch.setattr(llm_service.settings, "groq_api_key", None)
    monkeypatch.setattr(llm_service.settings, "openrouter_api_key", None)
    monkeypatch.setattr(llm_service.settings, "anthropic_api_key", None)
    assert await LLMService()._candidate_providers("ollama") == ["nvidia"]
    status = await LLMService().check_providers_status()
    assert status["nvidia"] is True and "ollama" not in status


async def test_long_output_puts_groq_ahead_of_nvidia(monkeypatch) -> None:
    from src.utils.reasoning_context import long_output

    monkeypatch.setattr(llm_service.settings, "nvidia_api_key", "nv")
    monkeypatch.setattr(llm_service.settings, "groq_api_key", "g")
    monkeypatch.setattr(llm_service.settings, "openrouter_api_key", "or")
    monkeypatch.setattr(llm_service.settings, "anthropic_api_key", "a")
    svc = LLMService()
    assert await svc._candidate_providers("auto") == ["nvidia", "groq", "minimax", "claude"]
    with long_output():
        assert await svc._candidate_providers("auto") == ["groq", "nvidia", "minimax", "claude"]
        # An explicit pick is still honored first.
        assert (await svc._candidate_providers("nvidia"))[0] == "nvidia"
    # Without Groq there is nothing to reorder around.
    monkeypatch.setattr(llm_service.settings, "groq_api_key", None)
    with long_output():
        assert await svc._candidate_providers("auto") == ["nvidia", "minimax", "claude"]


@pytest.mark.parametrize("name, long", [
    ("generate_test_questions", True),
    ("generate_module_content", True),
    ("generate_podcast_episode", True),
    ("generate_flashcards", False),
    ("derive_mcq_answers", False),
    ("call_kojo", False),
])
def test_bulk_generators_are_marked_long_output(name: str, long: bool) -> None:
    method = getattr(LLMService, name)
    assert ("_long_output" in method.__code__.co_qualname) is long
