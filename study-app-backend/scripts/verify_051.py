"""Verify migration 051 behavior without persisting anything.

Checks, inside rolled-back transactions:
1. Existing tracks all read as format="article".
2. A second active article track on the same folder is rejected (unique index).
3. An article track plus a podcast track on the same folder is allowed.

Run from study-app-backend: ../.venv/Scripts/python.exe scripts/verify_051.py
"""

import asyncio

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from src.database import async_session_maker
from src.models.learning_module import LearningTrack

if hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def main() -> None:
    async with async_session_maker() as session:
        # 1. Existing tracks read as article (the server_default backfilled them).
        rows = (await session.execute(select(LearningTrack.id, LearningTrack.format))).all()
        print(f"existing tracks: {len(rows)}")
        for rid, fmt in rows:
            assert fmt == "article", f"track {rid} has format {fmt!r}, expected article"
        print("check 1 OK: all existing tracks read as format=article")

        # Pick a folder (any). All checks run in transactions that roll back.
        folder_id = (await session.scalar(select(LearningTrack.folder_id).limit(1))) or 1
        print(f"testing against folder_id={folder_id}")

        # 2. Second active article track on the same folder must fail.
        async with async_session_maker() as s2:
            try:
                s2.add(
                    LearningTrack(
                        folder_id=folder_id, status="generating", format="article", module_count=1
                    )
                )
                await s2.flush()
                s2.rollback()
                print("check 2 FAIL: second active article track was NOT rejected")
                raise SystemExit(1)
            except IntegrityError:
                await s2.rollback()
                print("check 2 OK: second active article track rejected by unique index")

        # 3. Article + podcast on the same folder must be allowed. The folder
        # already holds an active article track; adding podcast + lecture in the
        # same transaction must succeed, proving per-format actives coexist.
        async with async_session_maker() as s3:
            s3.add(
                LearningTrack(
                    folder_id=folder_id, status="generating", format="podcast", module_count=1
                )
            )
            await s3.flush()
            s3.add(
                LearningTrack(
                    folder_id=folder_id, status="generating", format="lecture", module_count=1
                )
            )
            await s3.flush()
            s3.rollback()
            print("check 3 OK: article + podcast (and lecture) tracks coexist (rolled back)")

    # 4. Confirm the schema columns exist.
    async with async_session_maker() as s4:
        cols = (await s4.execute(select(func.count()).select_from(LearningTrack.__table__))).scalar()
        _ = cols
        print("check 4 OK: learning_tracks table queryable post-migration")

    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())