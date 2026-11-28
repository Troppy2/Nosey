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
