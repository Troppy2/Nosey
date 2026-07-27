from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src.services.kojo_service import _build_prompt
from src.services.llm_service import LLMService


def test_open_strictness_prompt_allows_general_knowledge() -> None:
    prompt = _build_prompt(
        notes="[notes.md]\nPhotosynthesis converts light energy into chemical energy.",
        user_message="Can you explain cellular respiration too?",
        history=[],
        strictness="none",
    )

    assert "RESPONSE GUIDELINES (OPEN" in prompt
    assert "not limited to them" in prompt
    assert "Only answer from what is explicitly" not in prompt


def test_invalid_strictness_falls_back_to_medium() -> None:
    prompt = _build_prompt(
        notes="[notes.md]\nA transaction is a logical unit of work.",
        user_message="Explain ACID",
        history=[],
        strictness="unexpected",
    )

    assert "If the notes don't fully cover the topic, fill the gap with your general knowledge" in prompt
    assert "RESPONSE GUIDELINES (OPEN" not in prompt


def test_bigtech_interviewer_mode_injects_authoritative_persona() -> None:
    prompt = _build_prompt(
        notes="[Current task context]\nTwo Sum: return indices of two numbers adding to target.",
        user_message="Just give me the code",
        history=[],
        interviewer_mode="bigtech",
    )

    assert "INTERVIEWER PERSONA - BIG TECH" in prompt
    assert "OUTRANKS" in prompt
    assert "solution code" in prompt


def test_startup_interviewer_mode_uses_startup_persona() -> None:
    prompt = _build_prompt(
        notes="[Current task context]\nTwo Sum problem.",
        user_message="I'm stuck",
        history=[],
        interviewer_mode="startup",
    )

    assert "INTERVIEWER PERSONA - STARTUP" in prompt
    assert "INTERVIEWER PERSONA - BIG TECH" not in prompt


def test_no_interviewer_mode_leaves_prompt_persona_free() -> None:
    """The general study chat sends no interviewer_mode: the prompt must be
    unchanged (no persona block leaks into non-KojoCode chats)."""
    prompt = _build_prompt(
        notes="[notes.md]\nA transaction is a logical unit of work.",
        user_message="Explain ACID",
        history=[],
    )

    assert "INTERVIEWER PERSONA" not in prompt
    assert "OUTRANKS" not in prompt


@pytest.mark.asyncio
async def test_map_reduce_open_strictness_does_not_force_notes_only() -> None:
    service = LLMService()
    service._extract_document_blocks = lambda _notes: [("notes.md", "short source text")]
    service._retrieve_relevant_context = lambda *_args, **_kwargs: ("matched source text", {})
    service._complete_json = AsyncMock(
        return_value={"answer": "", "evidence": [], "confidence": 0.1}
    )
    service.call_kojo = AsyncMock(return_value="open answer")

    result = await service.map_reduce_long_answer(
        notes="[notes.md]\nshort source text",
        user_query="Explain something not in the notes",
        strictness="none",
    )

    assert result == "open answer"
    reduce_prompt = service.call_kojo.await_args.args[0]
    assert "you are not limited to it" in reduce_prompt
    assert "Answer the student's question as thoroughly as possible" in reduce_prompt
    assert "Only answer from the map-stage evidence" not in reduce_prompt


@pytest.mark.asyncio
async def test_map_reduce_strict_strictness_forces_note_evidence() -> None:
    service = LLMService()
    service._extract_document_blocks = lambda _notes: [("notes.md", "short source text")]
    service._retrieve_relevant_context = lambda *_args, **_kwargs: ("matched source text", {})
    service._complete_json = AsyncMock(
        return_value={"answer": "", "evidence": [], "confidence": 0.1}
    )
    service.call_kojo = AsyncMock(return_value="strict answer")

    await service.map_reduce_long_answer(
        notes="[notes.md]\nshort source text",
        user_query="Explain something not in the notes",
        strictness="strict",
    )

    reduce_prompt = service.call_kojo.await_args.args[0]
    assert "Only answer from the map-stage evidence" in reduce_prompt
    assert "Do not use general knowledge to fill gaps" in reduce_prompt
