"""OCR redo on Results (GH #149) and transcript/feedback normalization.

Unit tests for the transcript cleaner, degenerate-loop detector, LEGIBILITY
parsing and final-answer formatting, plus an end-to-end grading run on the
in-memory SQLite database: an unreadable draw-only answer is held, its key
redacted, then fixed once and regraded in place.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src.models.folder import Folder
from src.models.frq_answer import FRQAnswer
from src.models.mcq_option import MCQOption
from src.models.question import Question
from src.models.test import Test
from src.models.user import User
from src.schemas.attempt_schema import (
    FRQGrade,
    OcrResult,
    RedoAnswerRequest,
    SubmittedAnswer,
)
from src.services import ocr_service
from src.services.grading_service import GradingService
from src.services.ocr_service import (
    OcrService,
    _parse_transcription,
    is_degenerate_transcript,
    normalize_transcript,
)
from src.utils.exceptions import ValidationException
from src.utils.latex_utils import format_final_answer, normalize_latex

pytestmark = pytest.mark.asyncio

# 1x1 PNG, valid for the request validators.
_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
)


# ── Transcript cleanup ──────────────────────────────────────────────────


async def test_runaway_quad_loop_is_degenerate_and_reads_as_empty() -> None:
    loop = "$" + r"\quad " * 600
    assert is_degenerate_transcript(loop)
    result = _parse_transcription(loop, "gemini")
    assert result.transcript == ""
    assert result.confidence == 0.0


async def test_ordinary_work_is_not_degenerate() -> None:
    work = "\n".join([r"$x^2 - 4 = 0$", r"$(x-2)(x+2) = 0$", r"$x = \pm 2$"])
    assert not is_degenerate_transcript(work)


async def test_normalize_makes_display_math_inline_and_drops_spacing() -> None:
    raw = "\n".join([
        "True",
        r"$$W X^T \epsilon = 0$$",
        r"$$\uparrow$$",
        r"Since $\epsilon_4 = 0$ \quad\quad done",
        r"$\qquad$",
    ])
    assert normalize_transcript(raw) == "\n\n".join([
        "True",
        r"$W X^T \epsilon = 0$",
        r"$\uparrow$ Since $\epsilon_4 = 0$ done",
    ])


async def test_normalize_keeps_adjacent_inline_spans_apart() -> None:
    assert normalize_transcript(r"$a$ $b$") == r"$a$ $b$"


async def test_multiline_display_block_becomes_one_inline_span() -> None:
    assert normalize_transcript("$$a +\nb$$") == "$a + b$"


@pytest.mark.parametrize(
    ("word", "confidence"),
    [("high", 0.9), ("medium", 0.6), ("low", 0.25), ("Low.", 0.25), ("", 0.75)],
)
async def test_legibility_word_sets_confidence(word: str, confidence: float) -> None:
    raw = f"TRANSCRIPT: $x = 4$\n---\nLAYOUT: NONE\n---\nLEGIBILITY: {word}"
    result = _parse_transcription(raw, "claude")
    assert result.transcript == "$x = 4$"
    assert result.layout_notes is None
    assert result.confidence == confidence


async def test_a_dashed_line_inside_the_transcript_does_not_split_sections() -> None:
    raw = "a --- b\n---\nLAYOUT: boxed answer\n---\nLEGIBILITY: high"
    result = _parse_transcription(raw, "claude")
    assert result.transcript == "a --- b"
    assert result.layout_notes == "boxed answer"


async def test_low_legibility_gives_the_next_engine_a_turn(monkeypatch) -> None:
    monkeypatch.setattr("src.config.settings.google_ai_api_key", "g")
    monkeypatch.setattr("src.config.settings.anthropic_api_key", "c")
    monkeypatch.setattr("src.config.settings.ocr_engine_order", "gemini,claude")

    def engine(name: str, confidence: float):
        async def run(image_b64: str, media_type: str) -> OcrResult:
            return OcrResult(transcript=f"{name} read", confidence=confidence, engine=name)
        return run

    monkeypatch.setitem(ocr_service._OCR_ENGINES, "gemini", engine("gemini", 0.25))
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "claude", engine("claude", 0.9))
    assert (await OcrService().transcribe(_PNG_B64)).engine == "claude"

    # Both low: the first low read comes back, for the caller to hold.
    monkeypatch.setitem(ocr_service._OCR_ENGINES, "claude", engine("claude", 0.25))
    result = await OcrService().transcribe(_PNG_B64)
    assert result is not None and result.engine == "gemini"


# ── Feedback formatting ─────────────────────────────────────────────────


async def test_bare_greek_with_subscript_is_wrapped_whole() -> None:
    assert normalize_latex(r"setting \epsilon_4 = 0 removes it") == r"setting $\epsilon_4$ = 0 removes it"
    assert normalize_latex(r"so \hat{y} drops x_4") == r"so $\hat{y}$ drops x_4"


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("TRUE", "TRUE"),
        ("False", "False"),
        ("x = 4", "$$x = 4$$"),
        (r"\frac{1}{2}", r"$$\frac{1}{2}$$"),
        ("7", "$$7$$"),
        ("$$x = 4$$", "$$x = 4$$"),
        (
            r"For each user, find the closest centroid $\omega_i$ and recommend its top movies.",
            r"For each user, find the closest centroid $\omega_i$ and recommend its top movies.",
        ),
        (
            r"\text{For each user, find the closest centroid and recommend its top movies}",
            "For each user, find the closest centroid and recommend its top movies",
        ),
    ],
)
async def test_final_answer_is_display_math_only_when_it_is_math(answer: str, expected: str) -> None:
    assert format_final_answer(answer) == expected


# ── Which drawings get held ─────────────────────────────────────────────


def _q(qtype: str) -> Question:
    return Question(question_text="q", question_type=qtype, display_order=0)


async def test_drawing_matters_only_where_it_decides_the_grade() -> None:
    matters = GradingService._drawing_matters
    assert matters(_q("MCQ"), "", is_math_mode=False, is_coding_mode=False)  # draw-only
    assert not matters(_q("MCQ"), "B", is_math_mode=True, is_coding_mode=False)  # option picked
    assert matters(_q("FRQ"), "x = 4", is_math_mode=True, is_coding_mode=False)  # work is graded
    assert not matters(_q("FRQ"), "an essay", is_math_mode=False, is_coding_mode=False)


async def test_draw_only_answer_outside_math_frq_is_graded_on_its_transcript() -> None:
    work = OcrResult(transcript="mitochondria", confidence=0.9, engine="claude")
    pick = GradingService._answer_for_grading
    assert pick(_q("FRQ"), "", work, is_math_mode=False, is_coding_mode=False) == "mitochondria"
    # Math FRQ grading reads the work itself.
    assert pick(_q("FRQ"), "", work, is_math_mode=True, is_coding_mode=False) == ""
    assert pick(_q("FRQ"), "typed", work, is_math_mode=False, is_coding_mode=False) == "typed"


# ── End to end on SQLite ────────────────────────────────────────────────


async def _seed(session) -> tuple[User, Test, Question, Question]:
    user = User(email="ocr@example.com", google_id="g-ocr", is_beta=True)
    session.add(user)
    await session.flush()
    folder = Folder(user_id=user.id, name="Linear Algebra")
    session.add(folder)
    await session.flush()
    test = Test(folder_id=folder.id, title="Exam", test_type="mixed", is_math_mode=True)
    session.add(test)
    await session.flush()
    frq = Question(test_id=test.id, question_text="Solve x + 1 = 5", question_type="FRQ", display_order=0)
    mcq = Question(test_id=test.id, question_text="Pick 2", question_type="MCQ", display_order=1)
    session.add_all([frq, mcq])
    await session.flush()
    session.add(FRQAnswer(question_id=frq.id, expected_answer="x = 4"))
    session.add_all([
        MCQOption(question_id=mcq.id, option_text="1", is_correct=False, display_order=0),
        MCQOption(question_id=mcq.id, option_text="2", is_correct=True, display_order=1),
    ])
    await session.commit()
    return user, test, frq, mcq


def _service(monkeypatch, reads: list[OcrResult | None]) -> GradingService:
    service = GradingService(llm_service=AsyncMock())
    service.llm_service.grade_math_answer = AsyncMock(
        return_value=FRQGrade(is_correct=True, feedback="Nice", confidence=0.9)
    )
    service.llm_service.explain_objective_answer = AsyncMock(
        return_value=type("R", (), {"feedback": "", "reasoning": None, "answer_key_ok": True, "actual_correct_answer": None})()
    )
    queue = list(reads)
    monkeypatch.setattr(service.ocr_service, "transcribe", AsyncMock(side_effect=lambda *a, **k: queue.pop(0)))
    return service


async def test_unreadable_draw_only_answer_is_held_then_fixed_once(db_session_maker, monkeypatch) -> None:
    async with db_session_maker() as session:
        user, test, frq, mcq = await _seed(session)
        service = _service(monkeypatch, [None, OcrResult(transcript="$x = 4$", confidence=0.9, engine="claude")])

        result = await service.submit_and_grade(
            test.id,
            user.id,
            [
                SubmittedAnswer(question_id=frq.id, answer="", work_image=_PNG_B64),
                SubmittedAnswer(question_id=mcq.id, answer="2"),
            ],
            session,
        )
        held = next(a for a in result.answers if a.question_id == frq.id)
        assert result.is_provisional
        assert held.ocr_status == "needs_input"
        assert held.correct_answer is None and held.feedback is None  # key redacted
        assert result.correct_count == 1 and result.score == 50.0
        service.llm_service.grade_math_answer.assert_not_awaited()  # nothing spent on it

        detail = await service.get_attempt_detail(result.attempt_id, user.id, session)
        assert detail.is_provisional
        assert next(a for a in detail.answers if a.question_id == frq.id).correct_answer is None
        summaries = await service.list_attempts(test.id, user.id, session)
        assert summaries[0].is_provisional

        redo = await service.redo_answer(
            result.attempt_id, frq.id, user.id, RedoAnswerRequest(work_image=_PNG_B64), session
        )
        assert not redo.is_provisional
        assert redo.score == 100.0 and redo.correct_count == 2
        fixed = redo.answers[0]
        assert fixed.ocr_status == "resolved"
        assert fixed.correct_answer == "x = 4"
        assert fixed.user_answer == "$x = 4$"

        with pytest.raises(ValidationException):
            await service.redo_answer(
                result.attempt_id, frq.id, user.id, RedoAnswerRequest(answer="x = 4"), session
            )


async def test_skip_grades_a_held_answer_as_blank(db_session_maker, monkeypatch) -> None:
    async with db_session_maker() as session:
        user, test, frq, _ = await _seed(session)
        service = _service(monkeypatch, [None])
        result = await service.submit_and_grade(
            test.id, user.id, [SubmittedAnswer(question_id=frq.id, answer="", work_image=_PNG_B64)], session
        )
        assert result.is_provisional

        skipped = await service.skip_unreadable(result.attempt_id, user.id, [], session)
        assert not skipped.is_provisional
        assert skipped.answers[0].ocr_status == "skipped"
        assert skipped.answers[0].is_correct is False
        assert skipped.answers[0].correct_answer == "x = 4"  # revealed once resolved
        service.llm_service.grade_math_answer.assert_not_awaited()


async def test_readable_drawing_is_graded_and_its_transcript_saved(db_session_maker, monkeypatch) -> None:
    async with db_session_maker() as session:
        user, test, frq, _ = await _seed(session)
        service = _service(monkeypatch, [OcrResult(transcript="$x = 4$", confidence=0.9, engine="gemini")])
        result = await service.submit_and_grade(
            test.id, user.id, [SubmittedAnswer(question_id=frq.id, answer="", work_image=_PNG_B64)], session
        )
        assert not result.is_provisional
        detail = await service.get_attempt_detail(result.attempt_id, user.id, session)
        answer = detail.answers[0]
        assert answer.ocr_status == "ok"
        assert answer.work_transcript == "$x = 4$"
        assert answer.work_strokes is None
