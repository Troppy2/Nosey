"""Regressions from the 2026-09-25 learning-module provider outage.

Every provider failed one module build for a different reason: Claude
truncated at the JSON token cap, Ollama's reply failed JSON repair, and Groq
and Gemini returned 404 for retired models. These pin the fixes.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

from src.services.llm_service import (
    LLMService,
    _escape_invalid_backslashes,
    _gemini_headers,
    _gemini_thinking_config,
    _groq_reasoning_params,
)


# -- JSON backslash repair --------------------------------------------------------

def test_valid_escapes_are_kept_whole() -> None:
    # A correctly escaped LaTeX command must survive untouched.
    assert _escape_invalid_backslashes(r'"\\cdot"') == r'"\\cdot"'
    valid = '"a\\nb\\t\\"q\\" \\u00e9 \\/"'  # every escape here is valid JSON
    assert _escape_invalid_backslashes(valid) == valid
    assert json.loads(_escape_invalid_backslashes(valid)) == json.loads(valid)


def test_bare_latex_backslashes_are_doubled() -> None:
    assert _escape_invalid_backslashes(r'"\ge \sum \le"') == r'"\\ge \\sum \\le"'
    # \u not followed by 4 hex digits is not a unicode escape.
    assert _escape_invalid_backslashes(r'"\underline"') == r'"\\underline"'


def test_mixed_escaping_parses_with_latex_intact() -> None:
    """The reproduced gemma4:31b failure: bare \\ge next to escaped \\\\cdot.

    The old per-backslash regex turned the valid \\\\cdot into \\\\\\cdot and
    the whole reply failed to parse."""
    raw = (
        '```json\n{"lesson": "Joint pmf: $f(x, y) \\ge 0$ and '
        '$\\\\sum_x \\\\sum_y f(x,y) = 1$.\\n\\nNext line.", '
        '"questions": [{"question": "Which is right?", '
        '"options": ["$f(y|x) = f(x,y) \\\\cdot f_X(x)$", "$\\le 1$"], "correct_index": 0}]}\n```'
    )
    data = LLMService()._loads_json(raw)
    lesson = data["lesson"]
    assert "\\ge 0" in lesson
    assert "\\sum_x \\sum_y" in lesson
    assert "\n\nNext line." in lesson  # real newlines, not literal backslash-n
    assert data["questions"][0]["options"][0] == "$f(y|x) = f(x,y) \\cdot f_X(x)$"
    assert data["questions"][0]["options"][1] == "$\\le 1$"


def test_already_valid_json_is_unchanged() -> None:
    payload = {"lesson": "Use $\\frac{a}{b}$ and $\\cdot$.\nDone."}
    assert LLMService()._loads_json(json.dumps(payload)) == payload


# -- Groq / Gemini request settings ------------------------------------------------

def test_groq_reasoning_params_per_model() -> None:
    assert _groq_reasoning_params("openai/gpt-oss-120b") == {"reasoning_effort": "low", "reasoning_format": "hidden"}
    assert _groq_reasoning_params("qwen/qwen3.8-27b") == {"reasoning_format": "hidden"}
    assert _groq_reasoning_params("some-plain-model") == {}


def test_gemini_thinking_only_for_gemini_3() -> None:
    assert _gemini_thinking_config("gemini-3.8-flash") == {"thinkingConfig": {"thinkingLevel": "low"}}
    assert _gemini_thinking_config("gemini-2.5-flash") == {}


def test_gemini_key_goes_in_header_not_url(monkeypatch) -> None:
    """httpx logs request URLs at INFO: a ?key= query string leaked the key."""
    monkeypatch.setattr("src.services.llm_service.settings.google_ai_api_key", "secret-key")
    assert _gemini_headers()["x-goog-api-key"] == "secret-key"


async def test_gemini_request_has_no_key_in_url(monkeypatch) -> None:
    monkeypatch.setattr("src.services.llm_service.settings.google_ai_api_key", "secret-key")
    monkeypatch.setattr("src.services.llm_service.settings.google_ai_model", "gemini-3.8-flash")

    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value={"candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}]})
    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    with patch("src.services.llm_service.httpx.AsyncClient", return_value=client):
        result = await LLMService()._complete_gemini("prompt", max_tokens=16384)

    assert result == {"ok": True}
    call = client.post.call_args
    assert "secret-key" not in call.args[0]
    assert "params" not in call.kwargs or "key" not in (call.kwargs.get("params") or {})
    assert call.kwargs["headers"]["x-goog-api-key"] == "secret-key"
    gen = call.kwargs["json"]["generationConfig"]
    assert gen["maxOutputTokens"] == 16384
    assert gen["thinkingConfig"] == {"thinkingLevel": "low"}


# -- MiniMax via OpenRouter ----------------------------------------------------------

def _fake_client(json_payload):
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value=json_payload)
    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


async def test_minimax_json_request_shape(monkeypatch) -> None:
    monkeypatch.setattr("src.services.llm_service.settings.openrouter_api_key", "or-key")
    monkeypatch.setattr("src.services.llm_service.settings.openrouter_model", "minimax/minimax-m3")
    client = _fake_client({
        "choices": [{"message": {"content": '{"ok": true}'}}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 3},
    })
    with patch("src.services.llm_service.httpx.AsyncClient", return_value=client):
        result = await LLMService()._complete_json_for_provider("prompt", "minimax", max_tokens=16384)

    assert result == {"ok": True}
    call = client.post.call_args
    assert call.args[0] == "https://openrouter.ai/api/v1/chat/completions"
    assert call.kwargs["headers"]["Authorization"] == "Bearer or-key"
    body = call.kwargs["json"]
    assert body["model"] == "minimax/minimax-m3"
    assert body["max_tokens"] == 16384
    assert body["response_format"] == {"type": "json_object"}
    # Reasoning model: thinking must never land in the content.
    assert body["reasoning"] == {"effort": "low", "exclude": True}


async def test_minimax_replaces_gemini_in_auto_chain(monkeypatch) -> None:
    monkeypatch.setattr("src.services.llm_service.settings.groq_api_key", "g")
    monkeypatch.setattr("src.services.llm_service.settings.google_ai_api_key", "gem")
    monkeypatch.setattr("src.services.llm_service.settings.openrouter_api_key", "or")
    monkeypatch.setattr("src.services.llm_service.settings.anthropic_api_key", "a")
    svc = LLMService()
    with patch.object(LLMService, "check_providers_status", AsyncMock(return_value={"ollama": True})):
        assert await svc._candidate_providers("auto") == ["ollama", "groq", "minimax", "claude"]
        # Gemini stays usable when picked explicitly (admin/beta).
        assert (await svc._candidate_providers("gemini"))[0] == "gemini"


async def test_minimax_not_in_chain_without_key(monkeypatch) -> None:
    monkeypatch.setattr("src.services.llm_service.settings.groq_api_key", None)
    monkeypatch.setattr("src.services.llm_service.settings.openrouter_api_key", None)
    monkeypatch.setattr("src.services.llm_service.settings.anthropic_api_key", "a")
    with patch.object(LLMService, "check_providers_status", AsyncMock(return_value={"ollama": False})):
        assert await LLMService()._candidate_providers("auto") == ["claude"]
