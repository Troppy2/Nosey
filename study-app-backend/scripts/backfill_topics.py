#!/usr/bin/env python3
"""
One-time backfill of topic tags on questions and flashcards that have none.

Tests made through the MCP connector before topics were required (and anything
older than migration 071) have NULL topics, so folder stats show no weak
topics for them. This asks the LLM to tag each untagged test or folder in one
pass (batched, one call per batch) and writes the result.

Usage:
    cd study-app-backend
    python scripts/backfill_topics.py --dry-run          # count only
    python scripts/backfill_topics.py                    # tag everything
    python scripts/backfill_topics.py --user-id 12       # one account
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.database import async_session_maker
from src.models.flashcard import Flashcard
from src.models.folder import Folder
from src.models.question import Question, full_question_text
from src.models.test import Test
from src.services.llm_service import LLMService


async def backfill(user_id: int | None, dry_run: bool) -> None:
    llm = LLMService()
    async with async_session_maker() as session:
        q_stmt = (
            select(Question, Test.title)
            .join(Test, Test.id == Question.test_id)
            .join(Folder, Folder.id == Test.folder_id)
            .where(Question.topic.is_(None))
            .options(selectinload(Question.group))
        )
        c_stmt = (
            select(Flashcard, Folder.name)
            .join(Folder, Folder.id == Flashcard.folder_id)
            .where(Flashcard.topic.is_(None))
        )
        if user_id is not None:
            q_stmt = q_stmt.where(Folder.user_id == user_id)
            c_stmt = c_stmt.where(Folder.user_id == user_id)

        tests: dict[int, tuple[str, list[Question]]] = defaultdict(lambda: ("", []))
        for question, title in (await session.execute(q_stmt)).all():
            tests[question.test_id] = (title, tests[question.test_id][1] + [question])
        folders: dict[int, tuple[str, list[Flashcard]]] = defaultdict(lambda: ("", []))
        for card, name in (await session.execute(c_stmt)).all():
            folders[card.folder_id] = (name, folders[card.folder_id][1] + [card])

        print(f"Untagged: {sum(len(q) for _, q in tests.values())} question(s) in {len(tests)} test(s), "
              f"{sum(len(c) for _, c in folders.values())} flashcard(s) in {len(folders)} folder(s).")
        if dry_run:
            return

        for test_id, (title, questions) in tests.items():
            try:
                topics = await llm.tag_topics(title, [(q.id, full_question_text(q)) for q in questions])
            except Exception as exc:
                print(f"  test {test_id}: skipped ({exc})")
                continue
            for q in questions:
                q.topic = topics.get(q.id)
            await session.commit()
            print(f"  test {test_id}: tagged {len(topics)}/{len(questions)}")

        for folder_id, (name, cards) in folders.items():
            try:
                topics = await llm.tag_topics(name, [(c.id, f"{c.front}\n{c.back}") for c in cards])
            except Exception as exc:
                print(f"  folder {folder_id} cards: skipped ({exc})")
                continue
            for c in cards:
                c.topic = topics.get(c.id)
            await session.commit()
            print(f"  folder {folder_id} cards: tagged {len(topics)}/{len(cards)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="count untagged rows without calling the LLM")
    parser.add_argument("--user-id", type=int, default=None, help="only this account's folders")
    args = parser.parse_args()
    # psycopg async can't run on Windows' default ProactorEventLoop.
    loop_factory = asyncio.SelectorEventLoop if sys.platform == "win32" else None
    asyncio.run(backfill(args.user_id, args.dry_run), loop_factory=loop_factory)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
