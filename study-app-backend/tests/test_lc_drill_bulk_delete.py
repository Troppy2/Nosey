"""3-Pass Drills bulk remove: POST /leetcode/drills/bulk-delete removes only the
listed drills, ignores unknown slugs, and reports how many rows went."""
from __future__ import annotations

import pytest

from tests.test_mcp_connector import client, seeded  # noqa: F401  (fixtures)


@pytest.mark.asyncio
async def test_bulk_delete_removes_only_listed_drills(client) -> None:  # noqa: F811
    for slug in ("two-sum", "valid-anagram", "group-anagrams"):
        assert (await client.post("/leetcode/drills", json={"problem_slug": slug})).status_code == 201

    res = await client.post(
        "/leetcode/drills/bulk-delete",
        json={"slugs": ["two-sum", "group-anagrams", "not-a-drill"]},
    )
    assert res.status_code == 200
    assert res.json() == {"deleted": 2}

    left = (await client.get("/leetcode/drills")).json()
    assert [d["problem_slug"] for d in left] == ["valid-anagram"]


@pytest.mark.asyncio
async def test_bulk_delete_rejects_empty_list(client) -> None:  # noqa: F811
    res = await client.post("/leetcode/drills/bulk-delete", json={"slugs": []})
    assert res.status_code == 422
