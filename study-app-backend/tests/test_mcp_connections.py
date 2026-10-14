"""Settings > Connected apps: list and disconnect MCP connections."""
from __future__ import annotations

import pytest

from tests.test_mcp_connector import _connect, _rpc, client, seeded  # noqa: F401  (fixtures)

pytestmark = pytest.mark.asyncio


async def test_list_and_disconnect(client, seeded) -> None:  # noqa: F811
    first = await _connect(client)
    second = await _connect(client)

    listed = (await client.get("/oauth/connections")).json()
    assert len(listed) == 2 and {c["client_name"] for c in listed} == {"Claude"}
    assert all(c["connected_at"] for c in listed)

    # Newest first: the second connection is listed first.
    newest = listed[0]["id"]
    assert (await client.delete(f"/oauth/connections/{newest}")).status_code == 204
    assert (await _rpc(client, second["access_token"], "ping")).status_code == 401
    assert (await _rpc(client, first["access_token"], "ping")).status_code == 200

    assert [c["id"] for c in (await client.get("/oauth/connections")).json()] == [listed[1]["id"]]
    # Disconnecting twice, or someone else's connection, is a 404.
    assert (await client.delete(f"/oauth/connections/{newest}")).status_code == 404


async def test_cannot_disconnect_another_users_app(client, seeded) -> None:  # noqa: F811
    await _connect(client)
    mine = (await client.get("/oauth/connections")).json()[0]["id"]
    client.state["user"] = seeded["other"]  # type: ignore[attr-defined]
    assert (await client.get("/oauth/connections")).json() == []
    assert (await client.delete(f"/oauth/connections/{mine}")).status_code == 404
