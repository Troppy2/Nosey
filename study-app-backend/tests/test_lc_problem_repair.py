"""Kojo repairs a generated problem whose reference solution failed its own tests."""
import pytest

from src.schemas.leetcode_schema import LCCustomTestCase, LCGeneratedCustomProblem
from src.services.leetcode_service import LeetCodeService
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException

PROBLEM = LCGeneratedCustomProblem(
    title="Count Evens",
    topic="Arrays",
    difficulty="Easy",
    description="Return how many numbers are even.",
    starter_code="class Solution:\n    def countEvens(self, nums):\n        pass",
    test_cases=[LCCustomTestCase(input_text="nums = [1, 2, 4]", output_text="3")],
    reference_solution="class Solution:\n    def countEvens(self, nums):\n        return sum(n % 2 == 0 for n in nums)",
)
FAILURES = [{"label": "Official 1", "input": "nums = [1, 2, 4]", "expected": "3", "actual": "2", "error": ""}]


def test_generated_problems_keep_the_reference_solution():
    problem = LeetCodeService()._normalize_generated_problem({"title": "T", "reference_solution": "class Solution: pass"})
    assert problem.reference_solution == "class Solution: pass"


def test_repair_prompt_shows_the_failure_and_the_runner_contract():
    prompt = LLMService()._build_problem_repair_prompt(PROBLEM.model_dump(), FAILURES)
    assert "expected `3` got `2`" in prompt
    assert "reference_solution" in prompt and "class Solution" in prompt


@pytest.mark.asyncio
async def test_repair_returns_the_fixed_problem(monkeypatch):
    seen = {}

    async def fake(self, problem, failures, provider=None):
        seen["failures"] = failures
        fixed = dict(problem)
        fixed["test_cases"] = [{"input_text": "nums = [1, 2, 4]", "output_text": "2", "explanation_text": "2 and 4"}]
        return fixed

    monkeypatch.setattr(LLMService, "repair_custom_problem", fake)
    fixed = await LeetCodeService().repair_custom_problem(PROBLEM, FAILURES)
    assert fixed.test_cases[0].output_text == "2"
    assert fixed.reference_solution == PROBLEM.reference_solution
    assert seen["failures"] == FAILURES


@pytest.mark.asyncio
async def test_a_failed_repair_is_an_llm_error(monkeypatch):
    async def boom(self, problem, failures, provider=None):
        raise RuntimeError("provider down")

    monkeypatch.setattr(LLMService, "repair_custom_problem", boom)
    with pytest.raises(LLMException):
        await LeetCodeService().repair_custom_problem(PROBLEM, FAILURES)


# ── The route ────────────────────────────────────────────────────────────────

import pytest_asyncio  # noqa: E402
from httpx import AsyncClient  # noqa: E402

from src.dependencies import get_current_user  # noqa: E402
from src.limiter import limiter  # noqa: E402
from src.main import app  # noqa: E402
from src.models.user import User  # noqa: E402
from src.routes import leetcode_repair  # noqa: E402


@pytest_asyncio.fixture
async def client(monkeypatch):
    screened: list[str] = []

    async def _screen(user, feature, *texts, **kwargs):
        screened.extend(t for t in texts if t)

    async def _repair(self, problem, failures, provider=None):
        return problem

    monkeypatch.setattr(leetcode_repair, "screen_user_input", _screen)
    monkeypatch.setattr(LeetCodeService, "repair_custom_problem", _repair)
    app.dependency_overrides[get_current_user] = lambda: User(id=1, email="t@example.test", google_id="g")
    limiter.reset()
    try:
        async with AsyncClient(app=app, base_url="http://test") as http:
            http.screened = screened  # type: ignore[attr-defined]
            yield http
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_route_screens_every_field_including_tests_and_failures(client):
    failures = [{"label": "Test 1", "input": "nums = [9]", "expected": "SECRET-EXPECTED", "actual": "SECRET-ACTUAL"}]
    problem = PROBLEM.model_dump()
    problem["test_cases"][0]["explanation_text"] = "SECRET-EXPLANATION"
    res = await client.post("/leetcode/custom-problems/repair", json={"problem": problem, "failures": failures})
    assert res.status_code == 200, res.text
    screened = " ".join(client.screened)
    for text in ("SECRET-EXPECTED", "SECRET-ACTUAL", "SECRET-EXPLANATION", "nums = [1, 2, 4]", "Count Evens"):
        assert text in screened


@pytest.mark.asyncio
async def test_route_rejects_oversized_problems(client):
    problem = PROBLEM.model_dump()
    problem["test_cases"] = problem["test_cases"] * 11
    res = await client.post("/leetcode/custom-problems/repair", json={"problem": problem, "failures": []})
    assert res.status_code == 400
    problem = PROBLEM.model_dump()
    problem["description"] = "x" * 70_000
    res = await client.post("/leetcode/custom-problems/repair", json={"problem": problem, "failures": []})
    assert res.status_code == 400
