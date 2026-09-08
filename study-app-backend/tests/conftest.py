"""Shared pytest fixtures for tests that need a real database.

Most of this codebase's tests mock the session entirely (see
test_create_test.py), which is right for testing routing/business logic.
A handful of tests exercise SQL/ORM behavior directly (recorrections,
deletes, resequencing, cascade behavior) where mocking the session would
just re-describe the code under test rather than verify it. Those use the
db_session_maker fixture below: an in-memory SQLite database, StaticPool so
all connections in one test share the same in-memory DB, and every model
table created from the real Base.metadata.
"""
from __future__ import annotations

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from src.models.base import Base


@pytest_asyncio.fixture
async def db_session_maker():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()
