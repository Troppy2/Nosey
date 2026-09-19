"""System Design mode: progress + autosave orchestration.

The rules under test are the ones a user would notice: a concept is only
complete when all five sub-modules are, completion time does not drift, and a
failing run can never take away a pass the user already earned.
"""
from __future__ import annotations

from src.models.user import User
from src.repositories.system_design_repository import SystemDesignRepository
from src.services.system_design_service import SystemDesignService

ALL_SUB_MODULES = ("notes", "video", "visualizer", "project", "quiz")


async def _make_user(session, email: str = "svc@example.com") -> User:
    user = User(email=email, google_id=f"google-{email}")
    session.add(user)
    await session.commit()
    return user


async def _row(session, user_id: int, concept_id: str = "caching"):
    return (await SystemDesignRepository(session).get_progress(user_id)).get(concept_id)


async def test_completed_at_is_null_until_all_five_submodules_done(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        service = SystemDesignService()

        for sub_module in ALL_SUB_MODULES[:4]:
            await service.mark_sub_module(user.id, "caching", sub_module, True, session)
        assert (await _row(session, user.id)).completed_at is None

        await service.mark_sub_module(user.id, "caching", "quiz", True, session)
        assert (await _row(session, user.id)).completed_at is not None


async def test_completed_at_is_stable_once_set(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        service = SystemDesignService()
        for sub_module in ALL_SUB_MODULES:
            await service.mark_sub_module(user.id, "caching", sub_module, True, session)
        first = (await _row(session, user.id)).completed_at

        await service.mark_sub_module(user.id, "caching", "notes", True, session)
        assert (await _row(session, user.id)).completed_at == first


async def test_completed_at_clears_when_a_submodule_flips_back(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        service = SystemDesignService()
        for sub_module in ALL_SUB_MODULES:
            await service.mark_sub_module(user.id, "caching", sub_module, True, session)
        assert (await _row(session, user.id)).completed_at is not None

        await service.mark_sub_module(user.id, "caching", "notes", False, session)
        assert (await _row(session, user.id)).completed_at is None


async def test_passing_a_run_flips_the_matching_submodule(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        await SystemDesignService().save_submission(
            user.id, "caching:visualizer", {"cache.py": "pass"}, True, session
        )

        row = await _row(session, user.id)
        assert row.visualizer_done is True
        assert row.project_done is False


async def test_a_failing_run_never_unsets_a_previous_pass(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        service = SystemDesignService()
        await service.save_submission(user.id, "caching:visualizer", {"cache.py": "ok"}, True, session)
        passed_at = (await SystemDesignRepository(session).get_submission(user.id, "caching:visualizer")).passed_at

        await service.save_submission(user.id, "caching:visualizer", {"cache.py": "broken"}, False, session)

        submission = await SystemDesignRepository(session).get_submission(user.id, "caching:visualizer")
        assert submission.last_run_passed is True
        assert submission.passed_at == passed_at
        assert (await _row(session, user.id)).visualizer_done is True


async def test_passed_at_is_stamped_once(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        service = SystemDesignService()
        await service.save_submission(user.id, "caching:project", {"store.py": "a"}, True, session)
        first = (await SystemDesignRepository(session).get_submission(user.id, "caching:project")).passed_at

        await service.save_submission(user.id, "caching:project", {"store.py": "b"}, True, session)
        assert (
            await SystemDesignRepository(session).get_submission(user.id, "caching:project")
        ).passed_at == first


async def test_autosave_does_not_touch_progress_when_ran_passed_false(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        await SystemDesignService().save_submission(
            user.id, "caching:visualizer", {"cache.py": "wip"}, False, session
        )

        assert await _row(session, user.id) is None
        submission = await SystemDesignRepository(session).get_submission(user.id, "caching:visualizer")
        assert submission is not None
        assert submission.last_run_passed is False
        assert submission.passed_at is None


async def test_autosave_persists_every_file(db_session_maker) -> None:
    files = {"store.py": "class Store: pass", "client.py": "class Client: pass"}
    async with db_session_maker() as session:
        user = await _make_user(session)
        await SystemDesignService().save_submission(user.id, "caching:project", files, False, session)

        result = await SystemDesignService().get_submission(user.id, "caching:project", session)
        assert result.files == files
        assert result.last_run_passed is False
        assert result.passed_at is None


async def test_get_submission_is_empty_when_absent(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        result = await SystemDesignService().get_submission(user.id, "caching:project", session)
        assert result.files == {}
        assert result.last_run_passed is False
        assert result.passed_at is None


async def test_get_progress_maps_every_concept_the_user_touched(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = await _make_user(session)
        service = SystemDesignService()
        await service.mark_sub_module(user.id, "caching", "notes", True, session)
        await service.mark_sub_module(user.id, "consistent-hashing", "video", True, session)

        progress = await service.get_progress(user.id, session)
        assert set(progress) == {"caching", "consistent-hashing"}
        assert progress["caching"].notes_done is True
        assert progress["consistent-hashing"].video_done is True
        assert progress["consistent-hashing"].notes_done is False
