"""Folder stats (topic tags, migration 071): weak/strong topics and score history."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from src.models.flashcard import Flashcard, FlashcardAttempt
from src.models.folder import Folder
from src.models.question import Question
from src.models.test import Test as TestRow
from src.models.user import User
from src.models.user_answer import UserAnswer
from src.models.user_attempt import UserAttempt
from src.services.folder_stats_service import (
    FolderStatsService,
    _Mark,
    classify,
    encouragement_for,
    missed_topics,
    summarize_topics,
)
from src.utils.exceptions import ResourceNotFoundException
from src.utils.topics import normalize_topic

T0 = datetime(2026, 10, 1)


def test_normalize_topic():
    assert normalize_topic("  cell respiration. ") == "Cell Respiration"
    assert normalize_topic("DNA replication") == "DNA Replication"
    assert normalize_topic("supply  and demand") == "Supply and Demand"
    assert normalize_topic("pH scale") == "pH Scale"
    assert normalize_topic("") is None
    assert normalize_topic(None) is None
    assert len(normalize_topic("x" * 200)) == 80


def test_classify_thresholds():
    assert classify(0.0, 2) == "new"
    assert classify(0.59, 3) == "weak"
    assert classify(0.6, 3) == "neutral"
    assert classify(0.8, 3) == "strong"


def test_summarize_uses_rolling_window_and_merges_case():
    # 20 old misses, then 20 recent hits: the window only sees the hits.
    marks = [_Mark("Cell Energy", False, T0 + timedelta(minutes=i), True) for i in range(20)]
    marks += [_Mark("cell energy", True, T0 + timedelta(hours=1, minutes=i), False) for i in range(20)]
    [stat] = summarize_topics(marks)
    assert stat.answers == 40
    assert stat.accuracy == 1.0
    assert stat.status == "strong"
    assert stat.test_answers == 20 and stat.flashcard_answers == 20


def test_summarize_orders_weakest_first_and_new_last():
    marks = [_Mark("A", True, T0, True)] * 3 + [_Mark("B", False, T0, True)] * 3 + [_Mark("C", False, T0, True)]
    assert [s.topic for s in summarize_topics(marks)] == ["B", "A", "C"]


def test_encouragement():
    assert encouragement_for([]) == "empty"
    assert encouragement_for([50]) == "first"
    assert encouragement_for([50, 50, 50, 70]) == "improving"
    assert encouragement_for([80, 80, 60]) == "dipping"
    assert encouragement_for([70, 72]) == "steady"


def test_missed_topics_skips_untagged_and_clean_topics():
    rows = [("Limits", False), ("limits", False), ("Limits", True), ("Derivatives", True), (None, False)]
    [only] = missed_topics(rows)
    assert (only.topic, only.missed, only.total) == ("Limits", 2, 3)


@pytest.mark.asyncio
async def test_get_stats_end_to_end(db_session_maker):
    async with db_session_maker() as session:
        user = User(email="u@example.com", google_id="g1")
        other = User(email="o@example.com", google_id="g2")
        session.add_all([user, other])
        await session.flush()
        folder = Folder(user_id=user.id, name="Bio")
        session.add(folder)
        await session.flush()
        test = TestRow(folder_id=folder.id, title="Quiz 1", test_type="MCQ_only")
        session.add(test)
        await session.flush()
        q1 = Question(test_id=test.id, question_text="q1", question_type="MCQ", display_order=1, topic="Mitosis")
        q2 = Question(test_id=test.id, question_text="q2", question_type="MCQ", display_order=2, topic="Mitosis")
        q3 = Question(test_id=test.id, question_text="q3", question_type="MCQ", display_order=3)
        session.add_all([q1, q2, q3])
        await session.flush()
        for number, (score, right) in enumerate([(33.3, False), (66.7, True)], start=1):
            attempt = UserAttempt(user_id=user.id, test_id=test.id, attempt_number=number, status="submitted",
                                  total_score=score, created_at=T0 + timedelta(days=number))
            session.add(attempt)
            await session.flush()
            session.add_all([
                UserAnswer(attempt_id=attempt.id, question_id=q1.id, user_answer="x", is_correct=right),
                UserAnswer(attempt_id=attempt.id, question_id=q2.id, user_answer="x", is_correct=False),
                UserAnswer(attempt_id=attempt.id, question_id=q3.id, user_answer="x", is_correct=True),
            ])
        draft = UserAttempt(user_id=user.id, test_id=test.id, attempt_number=3, status="in_progress")
        session.add(draft)
        card = Flashcard(folder_id=folder.id, front="f", back="b", topic="Osmosis")
        session.add(card)
        await session.flush()
        session.add_all([FlashcardAttempt(user_id=user.id, flashcard_id=card.id, correct=True) for _ in range(3)])
        session.add(FlashcardAttempt(user_id=other.id, flashcard_id=card.id, correct=False))
        await session.commit()

        stats = await FolderStatsService().get_stats(folder.id, user.id, session)
        assert stats.tests_taken == 2
        assert [p.score for p in stats.score_progression] == [33.3, 66.7]
        assert stats.latest_score == 66.7 and stats.best_score == 66.7
        assert stats.encouragement == "improving"
        by_topic = {t.topic: t for t in stats.topics}
        assert set(by_topic) == {"Mitosis", "Osmosis"}
        assert by_topic["Mitosis"].answers == 4 and by_topic["Mitosis"].status == "weak"
        assert by_topic["Osmosis"].answers == 3 and by_topic["Osmosis"].status == "strong"

        with pytest.raises(ResourceNotFoundException):
            await FolderStatsService().get_stats(folder.id, other.id, session)


# ---- daily quiz (chunk 5)

from src.schemas.folder_stats_schema import TopicStat  # noqa: E402
from src.services.folder_stats_service import local_day_window, plan_daily_quiz, todays_quiz  # noqa: E402


def _topic(name, accuracy, status, answers=5):
    return TopicStat(topic=name, accuracy=accuracy, answers=answers, test_answers=answers,
                     flashcard_answers=0, status=status, last_seen=T0)


def test_plan_daily_quiz_prefers_weak_then_reviews_strong():
    plan = plan_daily_quiz([
        _topic("Strong A", 0.95, "strong"), _topic("Weak B", 0.3, "weak"),
        _topic("Weak A", 0.2, "weak"), _topic("Mid", 0.7, "neutral"), _topic("Strong B", 0.85, "strong"),
    ])
    assert plan.focus == ["Weak A", "Weak B", "Mid"]
    assert plan.review == ["Strong B", "Strong A"]
    text = plan.instructions()
    assert "About 7 of the 10" in text and "other 3" in text


def test_plan_daily_quiz_all_strong_and_empty():
    assert plan_daily_quiz([]) is None
    plan = plan_daily_quiz([_topic("A", 0.9, "strong"), _topic("B", 0.82, "strong")])
    assert plan.focus == ["B", "A"] and plan.review == []
    assert "About 10 of the 10" in plan.instructions()


def test_local_day_window_uses_the_users_day():
    # 03:00 UTC on Oct 18 is still Oct 17 in Chicago (UTC-5 => offset +300).
    start, end = local_day_window(300, now=datetime(2026, 10, 18, 3, 0))
    assert start == datetime(2026, 10, 17, 5, 0) and end == datetime(2026, 10, 18, 5, 0)
    start, _ = local_day_window(0, now=datetime(2026, 10, 18, 3, 0))
    assert start == datetime(2026, 10, 18, 0, 0)


@pytest.mark.asyncio
async def test_todays_quiz_finds_only_todays_non_failed_daily(db_session_maker, monkeypatch):
    from src.services import folder_stats_service

    monkeypatch.setattr(folder_stats_service, "utcnow_naive", lambda: datetime(2026, 10, 17, 15, 0))
    async with db_session_maker() as session:
        user = User(email="u@example.com", google_id="g1")
        session.add(user)
        await session.flush()
        folder = Folder(user_id=user.id, name="Bio")
        session.add(folder)
        await session.flush()
        yesterday = TestRow(folder_id=folder.id, title="old", test_type="mixed", kind="daily",
                            created_at=datetime(2026, 10, 16, 15, 0))
        failed = TestRow(folder_id=folder.id, title="f", test_type="mixed", kind="daily",
                         generation_status="failed", created_at=datetime(2026, 10, 17, 9, 0))
        normal = TestRow(folder_id=folder.id, title="n", test_type="mixed", created_at=datetime(2026, 10, 17, 10, 0))
        session.add_all([yesterday, failed, normal])
        await session.commit()
        assert await todays_quiz(session, folder.id, user.id, 0) is None

        today = TestRow(folder_id=folder.id, title="t", test_type="mixed", kind="daily",
                        created_at=datetime(2026, 10, 17, 11, 0))
        session.add(today)
        await session.flush()
        found = await todays_quiz(session, folder.id, user.id, 0)
        assert found.test_id == today.id and found.completed is False
        session.add(UserAttempt(user_id=user.id, test_id=today.id, attempt_number=1, status="submitted", total_score=80))
        await session.commit()
        assert (await todays_quiz(session, folder.id, user.id, 0)).completed is True
