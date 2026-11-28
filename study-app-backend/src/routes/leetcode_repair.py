"""Kojo repairs a practice problem it wrote whose reference solution failed its own tests.

Its own module, without `from __future__ import annotations`: slowapi's limiter wrapper
hides module globals, so a rate-limited route with a string-annotated JSON body answers
422 (rules-gotchas). routes/leetcode.py uses the future import.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from src.dependencies import get_current_user
from src.limiter import limiter
from src.models.user import User
from src.schemas.leetcode_schema import LCGeneratedCustomProblem, LCRepairCustomProblemRequest
from src.services.account_safety_service import screen_user_input
from src.services.leetcode_service import LeetCodeService
from src.utils.exceptions import LLMException
from src.utils.provider_policy import resolve_request_provider

router = APIRouter(prefix="/leetcode", tags=["leetcode"])

# What a repair may carry. The prompt truncates further; these stop oversized bodies
# before they reach moderation or the model.
_MAX_TEST_CASES = 10
_MAX_TOTAL_CHARS = 60_000


@router.post("/custom-problems/repair", response_model=LCGeneratedCustomProblem)
@limiter.limit("12/minute")
async def repair_custom_problem(
    request: Request,
    response: Response,
    body: LCRepairCustomProblemRequest,
    user: User = Depends(get_current_user),
) -> LCGeneratedCustomProblem:
    """The browser runs the tests (the server runs no code) and calls this at most twice
    per problem; each call is one LLM request. The rate limit caps it server side."""
    problem = body.problem
    if len(problem.test_cases) > _MAX_TEST_CASES:
        raise HTTPException(status_code=400, detail="Too many test cases to repair.")
    case_text = [t for c in problem.test_cases for t in (c.input_text, c.output_text, c.explanation_text)]
    failure_text = [t for f in body.failures for t in (f.label, f.input, f.expected, f.actual, f.error)]
    fields = [
        problem.title,
        problem.topic,
        problem.subtopic,
        problem.description,
        problem.starter_code,
        problem.reference_solution,
        *case_text,
        *failure_text,
    ]
    if sum(len(t or "") for t in fields) > _MAX_TOTAL_CHARS:
        raise HTTPException(status_code=400, detail="That problem is too long to repair.")
    # GH #173: everything here reaches the model, so all of it is screened, test cases
    # and the reported failures included (the client could have edited any of it).
    await screen_user_input(user, "leetcode_custom", *fields)
    try:
        return await LeetCodeService().repair_custom_problem(
            problem,
            [f.model_dump() for f in body.failures],
            provider=resolve_request_provider(user, body.provider),
        )
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
