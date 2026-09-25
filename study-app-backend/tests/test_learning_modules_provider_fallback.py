"""
Regression tests: learning-module builds must fall back across providers.

Bug: building modules from a KojoChat action card "succeeded" (201) but the
Learning Modules page then showed an Ollama/LLM error. The card forwards the
user's chat model setting (default "ollama") as the build provider, and the
module generators called _complete_json(provider=...) once. A specific
provider in _complete_json is a single attempt with no fallback, and even on
"auto" a provider that returns well-formed but unusable JSON (no modules, empty
lesson) was never retried elsewhere. The detached build then marked the track
failed, which the user only saw when opening the modules page.

These tests drive the real _generate_track_background with a real LLMService.
Only the network boundary (_complete_json_for_provider) and provider status are
faked, so the provider-selection behavior under test is the production code.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from src.models.folder import Folder
from src.models.learning_module import LearningModule, LearningTrack
from src.models.user import User
from src.utils.exceptions import LLMException

pytestmark = pytest.mark.asyncio

OUTLINE = {"modules": [{"title": "Module 1", "summary": "Covers X"}]}
CONTENT = {
    "lesson": "## Lesson\nBody.",
    "tts_script": "Lesson. Body.",
    "questions": [{"question": "Q1?", "options": ["A", "B", "C", "D"], "correct_index": 0}],
}


async def _seed_track(session_maker, provider: str | None) -> tuple[int, int]:
    async with session_maker() as session:
        user = User(email="u@example.com", google_id="g1")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="F1")
        session.add(folder)
        await session.flush()
        track = LearningTrack(
            folder_id=folder.id, status="generating", module_count=1, format="article", provider=provider,
        )
        session.add(track)
        await session.commit()
        return track.id, folder.id


def _fake_provider(responses: dict[str, object]):
    """Per-provider fake of the network call. A value that is an Exception is
    raised; anything else is returned as the parsed JSON body."""
    calls: list[str] = []
    # max_tokens per call kind ("outline" / "content"), so tests can check the
    # module content call gets its raised budget.
    budgets: dict[str, object] = {}

    async def _call(prompt: str, provider: str, max_tokens=None) -> dict[str, object]:
        calls.append(provider)
        if "Split the material" in prompt:
            budgets["outline"] = max_tokens
        elif '"tts_script"' in prompt:
            budgets["content"] = max_tokens  # lesson + narration + quiz bundle
        result = responses[provider]
        if isinstance(result, Exception):
            raise result
        if "Split the material" in prompt:
            return result["outline"]  # type: ignore[index]
        return result["content"]  # type: ignore[index]

    _call.budgets = budgets  # type: ignore[attr-defined]
    return _call, calls


async def _run_build(db_session_maker, monkeypatch, provider, responses):
    from src.routes.learning_modules import _generate_track_background
    from src.services.llm_service import LLMService

    monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_enabled", False)
    monkeypatch.setattr("src.services.llm_service.settings.groq_api_key", "test-groq")
    monkeypatch.setattr("src.services.llm_service.settings.google_ai_api_key", "")
    monkeypatch.setattr("src.services.llm_service.settings.anthropic_api_key", "")

    track_id, folder_id = await _seed_track(db_session_maker, provider)
    fake_call, calls = _fake_provider(responses)
    fake_file_service = MagicMock()
    fake_file_service.get_folder_files_content = AsyncMock(return_value="folder notes")

    with (
        patch("src.routes.learning_modules.async_session_maker", db_session_maker),
        patch("src.routes.learning_modules.FileService", return_value=fake_file_service),
        patch.object(LLMService, "check_providers_status", AsyncMock(return_value={"ollama": True})),
        patch.object(LLMService, "_complete_json_for_provider", side_effect=fake_call, autospec=False),
    ):
        await _generate_track_background(
            track_id=track_id, user_id=1, folder_id=folder_id, module_count=1, provider=provider,
        )

    async with db_session_maker() as session:
        track = await session.get(LearningTrack, track_id)
        module = (await session.scalars(
            select(LearningModule).where(LearningModule.track_id == track_id)
        )).first()
    _run_build.last_budgets = fake_call.budgets  # type: ignore[attr-defined]
    return track, module, calls


class TestLearningModuleProviderFallback:

    async def test_module_content_uses_the_raised_token_budget(self, db_session_maker, monkeypatch):
        """Lesson + narration + quiz in one JSON object truncated Claude at
        8192 tokens; module content must request _MODULE_CONTENT_MAX_TOKENS,
        while the short outline call keeps the default."""
        from src.services.llm_service import _MODULE_CONTENT_MAX_TOKENS

        track, _module, _calls = await _run_build(
            db_session_maker, monkeypatch, "groq", {"groq": {"outline": OUTLINE, "content": CONTENT}},
        )
        assert track.status == "ready", track.error
        assert _run_build.last_budgets["content"] == _MODULE_CONTENT_MAX_TOKENS
        assert _run_build.last_budgets["outline"] is None

    async def test_kojo_card_pinned_ollama_failure_falls_back_and_track_is_ready(
        self, db_session_maker, monkeypatch,
    ):
        """The real Kojo scenario: provider="ollama" (the chat setting default)
        and Ollama cannot handle the request."""
        track, module, calls = await _run_build(
            db_session_maker, monkeypatch, "ollama",
            {
                "ollama": LLMException("Ollama returned an unexpected response format that couldn't be parsed as JSON."),
                "groq": {"outline": OUTLINE, "content": CONTENT},
            },
        )

        assert track.status == "ready", track.error
        assert track.error is None
        assert module is not None and module.lesson_content == "## Lesson\nBody."
        assert module.quiz_json is not None
        assert calls[0] == "ollama"  # the user's pick is still tried first
        assert "groq" in calls

    async def test_unusable_json_from_first_provider_falls_back_on_auto(
        self, db_session_maker, monkeypatch,
    ):
        """Ollama answers with valid JSON of the wrong shape. That is not a
        transport error, so the old auto chain accepted it and failed the build."""
        track, module, calls = await _run_build(
            db_session_maker, monkeypatch, "auto",
            {
                "ollama": {"outline": {"modules": []}, "content": {"lesson": ""}},
                "groq": {"outline": OUTLINE, "content": CONTENT},
            },
        )

        assert track.status == "ready", track.error
        assert module is not None and module.lesson_content
        assert calls.count("ollama") >= 1 and "groq" in calls

    async def test_all_providers_failing_still_marks_track_failed(self, db_session_maker, monkeypatch):
        track, module, calls = await _run_build(
            db_session_maker, monkeypatch, "ollama",
            {
                "ollama": LLMException("Ollama timed out."),
                "groq": LLMException("Groq rate limited."),
            },
        )

        assert track.status == "failed"
        assert track.error
        assert module is None
        assert calls == ["ollama", "groq"]  # one attempt per provider, no nested retries

    async def test_lesson_edit_regen_on_kojo_built_track_falls_back(self, monkeypatch):
        """Editing a lesson reuses track.provider, which a Kojo-built track
        stored as "ollama", so the regen call needs the same fallback."""
        from src.services.llm_service import LLMService

        monkeypatch.setattr("src.services.llm_service.settings.groq_api_key", "test-groq")
        monkeypatch.setattr("src.services.llm_service.settings.google_ai_api_key", "")
        monkeypatch.setattr("src.services.llm_service.settings.anthropic_api_key", "")
        fake_call, calls = _fake_provider({
            "ollama": LLMException("Ollama timed out."),
            "groq": {"outline": OUTLINE, "content": CONTENT},
        })

        with (
            patch.object(LLMService, "check_providers_status", AsyncMock(return_value={"ollama": True})),
            patch.object(LLMService, "_complete_json_for_provider", side_effect=fake_call),
        ):
            support = await LLMService().regenerate_module_support("## Edited\nBody.", "Module 1", provider="ollama")

        assert support["quiz"] and support["tts_script"] == "Lesson. Body."
        assert calls == ["ollama", "groq"]
