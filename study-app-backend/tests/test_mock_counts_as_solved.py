import pytest
from sqlalchemy import select

from src.models.lc_sync import LCActivityDate
from src.models.user import User
from src.routes.mock_interview import _count_loop_as_solved


@pytest.mark.asyncio
async def test_finished_loop_adds_one_to_today(db_session_maker):
    async with db_session_maker() as db:
        user = User(email="loop@example.com", google_id="google-loop", is_beta=True, is_admin=False)
        db.add(user)
        await db.commit()

        await _count_loop_as_solved(db, user.id, 0)
        await db.commit()
        await _count_loop_as_solved(db, user.id, 0)
        await db.commit()

        rows = (await db.execute(select(LCActivityDate).where(LCActivityDate.user_id == user.id))).scalars().all()
        assert len(rows) == 1
        assert rows[0].count == 2
