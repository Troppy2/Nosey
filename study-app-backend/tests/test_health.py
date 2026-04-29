from httpx import AsyncClient

from src.main import app


async def test_health_check() -> None:
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}
