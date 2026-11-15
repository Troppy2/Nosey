"""Graded feedback stored and returned as sections (migration 090)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from src.models.folder import Folder
from src.models.question import Question
from src.models.test import Test as TestModel
from src.models.user import User
from src.models.user_answer import UserAnswer
from src.repositories.test_repository import TestRepository as Repo, add_generated_questions
from src.schemas.attempt_schema import FeedbackSections, FeedbackStep, FRQGrade, SubmittedAnswer
from src.services.grading_service import GradingService
from src.services.llm_service import GeneratedFRQ, LLMService

pytestmark = pytest.mark.asyncio

_SECTIONS = FeedbackSections(
    what_to_fix="You took $\\Phi(2)$; you need $1 - \\Phi(2)$.",
    key_steps=[FeedbackStep(description="Upper tail", expression="1 - 0.9772")],
    final_answer="$$0.0228$$",
)


async def test_sections_are_stored_and_returned_with_the_attempt(db_session_maker) -> None:
    async with db_session_maker() as session:
        user = User(email="sections@example.com", google_id="g-sections")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="Stats")
        session.add(folder)
        await session.flush()
        test = TestModel(folder_id=folder.id, title="T", test_type="FRQ_only", is_math_mode=True)
        session.add(test)
        await session.flush()
        await add_generated_questions(Repo(session), test.id, [], [GeneratedFRQ("Find P(Z>2).", "0.0228")], 1)
        await session.commit()
        question = await session.scalar(select(Question))

        service = GradingService(llm_service=AsyncMock())
        service.llm_service.grade_math_answer = AsyncMock(
            return_value=FRQGrade(is_correct=False, feedback="md", confidence=0.9, sections=_SECTIONS)
        )
        result = await service.submit_and_grade(
            test.id, user.id, [SubmittedAnswer(question_id=question.id, answer="0.9772")], session
        )
        assert result.answers[0].feedback_sections == _SECTIONS

        row = await session.scalar(select(UserAnswer))
        assert row.feedback_sections and "0.0228" in row.feedback_sections
        detail = await service.get_attempt_detail(result.attempt_id, user.id, session)
        assert detail.answers[0].feedback_sections == _SECTIONS

        # An unreadable column falls back to the Markdown feedback, never an error.
        row.feedback_sections = "{not json"
        await session.commit()
        detail = await service.get_attempt_detail(result.attempt_id, user.id, session)
        assert detail.answers[0].feedback_sections is None and detail.answers[0].feedback == "md"


async def test_frq_grader_builds_sections_and_drops_fix_on_a_right_answer() -> None:
    svc = LLMService()
    svc._complete_json = AsyncMock(return_value={  # type: ignore[method-assign]
        "is_correct": True, "note": "You named both ACID properties.", "what_to_fix": "ignored",
        "final_answer": "Atomicity and durability.", "confidence": 0.9,
    })
    grade = await svc.grade_frq_answer("notes", "Name two.", "A and D", "A and D")
    assert grade.sections and grade.sections.note.startswith("You named")
    assert grade.sections.what_to_fix == ""
    assert grade.feedback.startswith("You named") and "**Answer:**" in grade.feedback


async def test_objective_explainer_builds_sections_with_the_key_as_answer() -> None:
    svc = LLMService()
    svc._complete_json = AsyncMock(return_value={  # type: ignore[method-assign]
        "note": "", "what_to_fix": "You picked the variance, not the SD.",
        "key_steps": [{"description": "Take the root", "expression": "\\sqrt{0.01} = 0.1"}],
    })
    result = await svc.explain_objective_answer("SD of Xbar?", "0.1", "0.01", is_correct=False, options=["0.1", "0.01"])
    assert result.sections and result.sections.what_to_fix.startswith("You picked")
    assert result.sections.final_answer == "$$0.1$$"
    assert "**Key steps**" in result.feedback
