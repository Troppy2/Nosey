"""
Wiring tests for integration point C: MCQ verification inside learning module
generation (_generate_track_background's per-module loop, the article format
path only; podcast/lecture formats have no MCQ quiz at all).

verify_module_quiz itself (the dict <-> VerifiableMCQ adapter, non-4-option
handling, recorrect/drop/repair mapping) is covered in
test_mcq_verification.py. These tests isolate the routes/learning_modules.py
wiring: quiz_count inflation, the lesson (not the folder notes) as the
verification source, the requested_count trim target, the disabled-flag
bypass, and fail-open on a verification exception.

Uses the db_session_maker fixture from conftest.py because module generation
really does persist to the database as it runs; LLMService, FileService, and
MCQVerificationService are all mocked.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.folder import Folder
from src.models.learning_module import LearningModule, LearningTrack
from src.models.user import User

pytestmark = pytest.mark.asyncio


async def _seed_track(session_maker, module_count: int = 1) -> tuple[int, int]:
    """Seed a User/Folder/LearningTrack with `module_count` empty module shells
    (as phase 1 of the real background task would have already created).
    Returns (track_id, folder_id)."""
    async with session_maker() as session:
        user = User(email="u@example.com", google_id="g1")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="F1")
        session.add(folder)
        await session.flush()
        track = LearningTrack(folder_id=folder.id, status="generating", module_count=module_count, format="article")
        session.add(track)
        await session.flush()
        await session.commit()
        return track.id, folder.id


def _fake_llm(lesson: str = "The lesson body.", quiz: list[dict] | None = None) -> MagicMock:
    llm = MagicMock()
    llm.generate_module_outline = AsyncMock(return_value=[{"title": "Module 1", "summary": "Covers X"}])
    llm.generate_module_content = AsyncMock(return_value={
        "lesson": lesson,
        "tts_script": "",
        "quiz": quiz if quiz is not None else [
            {"question": "Q1?", "options": ["A", "B", "C", "D"], "correct_index": 0},
        ],
    })
    return llm


class TestModuleGenerationVerificationWiring:

    async def test_quiz_count_inflated_when_modules_verification_enabled(self, db_session_maker, monkeypatch):
        from src.routes.learning_modules import _generate_track_background, QUIZ_QUESTION_COUNT

        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_modules_enabled", True)
        track_id, folder_id = await _seed_track(db_session_maker)
        llm = _fake_llm()
        fake_file_service = MagicMock()
        fake_file_service.get_folder_files_content = AsyncMock(return_value="folder notes")

        with (
            patch("src.routes.learning_modules.async_session_maker", db_session_maker),
            patch("src.routes.learning_modules.LLMService", return_value=llm),
            patch("src.routes.learning_modules.FileService", return_value=fake_file_service),
            patch("src.routes.learning_modules.MCQVerificationService") as mock_verifier_cls,
        ):
            fake_verifier = MagicMock()
            fake_verifier.verify_module_quiz = AsyncMock(
                return_value=([{"question": "Q1?", "options": ["A", "B", "C", "D"], "correct_index": 0}], {})
            )
            mock_verifier_cls.return_value = fake_verifier

            await _generate_track_background(
                track_id=track_id, user_id=1, folder_id=folder_id, module_count=1, provider=None,
            )

        content_kwargs = llm.generate_module_content.call_args.kwargs
        assert content_kwargs["quiz_count"] == QUIZ_QUESTION_COUNT + 2

    async def test_verify_module_quiz_called_with_lesson_as_source(self, db_session_maker, monkeypatch):
        from src.routes.learning_modules import _generate_track_background, QUIZ_QUESTION_COUNT

        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_modules_enabled", True)
        track_id, folder_id = await _seed_track(db_session_maker)
        llm = _fake_llm(lesson="THE LESSON TEXT")
        fake_file_service = MagicMock()
        fake_file_service.get_folder_files_content = AsyncMock(return_value="folder notes, not the lesson")

        with (
            patch("src.routes.learning_modules.async_session_maker", db_session_maker),
            patch("src.routes.learning_modules.LLMService", return_value=llm),
            patch("src.routes.learning_modules.FileService", return_value=fake_file_service),
            patch("src.routes.learning_modules.MCQVerificationService") as mock_verifier_cls,
        ):
            fake_verifier = MagicMock()
            fake_verifier.verify_module_quiz = AsyncMock(
                return_value=([{"question": "Q1?", "options": ["A", "B", "C", "D"], "correct_index": 0}], {})
            )
            mock_verifier_cls.return_value = fake_verifier

            await _generate_track_background(
                track_id=track_id, user_id=1, folder_id=folder_id, module_count=1, provider=None,
            )

        verify_kwargs = fake_verifier.verify_module_quiz.call_args.kwargs
        assert verify_kwargs["source_content"] == "THE LESSON TEXT"  # the lesson, not the folder notes
        assert verify_kwargs["requested_count"] == QUIZ_QUESTION_COUNT

    async def test_verified_quiz_replaces_generated_quiz_before_persistence(self, db_session_maker, monkeypatch):
        from src.routes.learning_modules import _generate_track_background

        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_modules_enabled", True)
        track_id, folder_id = await _seed_track(db_session_maker)
        original_quiz = [{"question": "Bad Q?", "options": ["A", "B", "C", "D"], "correct_index": 0}]
        llm = _fake_llm(quiz=original_quiz)
        fake_file_service = MagicMock()
        fake_file_service.get_folder_files_content = AsyncMock(return_value="folder notes")

        with (
            patch("src.routes.learning_modules.async_session_maker", db_session_maker),
            patch("src.routes.learning_modules.LLMService", return_value=llm),
            patch("src.routes.learning_modules.FileService", return_value=fake_file_service),
            patch("src.routes.learning_modules.MCQVerificationService") as mock_verifier_cls,
        ):
            fake_verifier = MagicMock()
            verified_quiz = [{"question": "Good Q?", "options": ["W", "X", "Y", "Z"], "correct_index": 1}]
            fake_verifier.verify_module_quiz = AsyncMock(return_value=(verified_quiz, {"repaired": 1}))
            mock_verifier_cls.return_value = fake_verifier

            await _generate_track_background(
                track_id=track_id, user_id=1, folder_id=folder_id, module_count=1, provider=None,
            )

        import json as _json
        async with db_session_maker() as session:
            from sqlalchemy import select
            module = (await session.scalars(
                select(LearningModule).where(LearningModule.track_id == track_id)
            )).first()
            stored_quiz = _json.loads(module.quiz_json)
            assert stored_quiz == verified_quiz  # NOT original_quiz

    async def test_disabled_flag_skips_inflation_and_verification(self, db_session_maker, monkeypatch):
        from src.routes.learning_modules import _generate_track_background, QUIZ_QUESTION_COUNT

        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_enabled", False)
        track_id, folder_id = await _seed_track(db_session_maker)
        llm = _fake_llm()
        fake_file_service = MagicMock()
        fake_file_service.get_folder_files_content = AsyncMock(return_value="folder notes")

        with (
            patch("src.routes.learning_modules.async_session_maker", db_session_maker),
            patch("src.routes.learning_modules.LLMService", return_value=llm),
            patch("src.routes.learning_modules.FileService", return_value=fake_file_service),
            patch("src.routes.learning_modules.MCQVerificationService") as mock_verifier_cls,
        ):
            await _generate_track_background(
                track_id=track_id, user_id=1, folder_id=folder_id, module_count=1, provider=None,
            )

        mock_verifier_cls.assert_not_called()
        content_kwargs = llm.generate_module_content.call_args.kwargs
        assert content_kwargs["quiz_count"] == QUIZ_QUESTION_COUNT

    async def test_modules_flag_alone_can_disable_without_disabling_test_verification(
        self, db_session_maker, monkeypatch,
    ):
        """mcq_verification_enabled stays on (tests keep verifying) while the
        separate per-module toggle turns off just the more expensive module path."""
        from src.routes.learning_modules import _generate_track_background, QUIZ_QUESTION_COUNT

        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_modules_enabled", False)
        track_id, folder_id = await _seed_track(db_session_maker)
        llm = _fake_llm()
        fake_file_service = MagicMock()
        fake_file_service.get_folder_files_content = AsyncMock(return_value="folder notes")

        with (
            patch("src.routes.learning_modules.async_session_maker", db_session_maker),
            patch("src.routes.learning_modules.LLMService", return_value=llm),
            patch("src.routes.learning_modules.FileService", return_value=fake_file_service),
            patch("src.routes.learning_modules.MCQVerificationService") as mock_verifier_cls,
        ):
            await _generate_track_background(
                track_id=track_id, user_id=1, folder_id=folder_id, module_count=1, provider=None,
            )

        mock_verifier_cls.assert_not_called()
        content_kwargs = llm.generate_module_content.call_args.kwargs
        assert content_kwargs["quiz_count"] == QUIZ_QUESTION_COUNT

    async def test_verification_exception_does_not_block_module_save(self, db_session_maker, monkeypatch):
        from src.routes.learning_modules import _generate_track_background

        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_enabled", True)
        monkeypatch.setattr("src.routes.learning_modules.settings.mcq_verification_modules_enabled", True)
        track_id, folder_id = await _seed_track(db_session_maker)
        llm = _fake_llm(lesson="A perfectly good lesson.")
        fake_file_service = MagicMock()
        fake_file_service.get_folder_files_content = AsyncMock(return_value="folder notes")

        with (
            patch("src.routes.learning_modules.async_session_maker", db_session_maker),
            patch("src.routes.learning_modules.LLMService", return_value=llm),
            patch("src.routes.learning_modules.FileService", return_value=fake_file_service),
            patch("src.routes.learning_modules.MCQVerificationService") as mock_verifier_cls,
        ):
            fake_verifier = MagicMock()
            fake_verifier.verify_module_quiz = AsyncMock(side_effect=Exception("verifier exploded"))
            mock_verifier_cls.return_value = fake_verifier

            await _generate_track_background(
                track_id=track_id, user_id=1, folder_id=folder_id, module_count=1, provider=None,
            )

        async with db_session_maker() as session:
            from sqlalchemy import select
            track = await session.get(LearningTrack, track_id)
            module = (await session.scalars(
                select(LearningModule).where(LearningModule.track_id == track_id)
            )).first()
            assert track.status == "ready"  # generation still completes
            assert module.lesson_content == "A perfectly good lesson."
            assert module.quiz_json is not None  # the original quiz was still saved
