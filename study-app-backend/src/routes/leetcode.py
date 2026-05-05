from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.leetcode_schema import (
    LeetCodeHintRequest,
    LeetCodeHintResponse,
    LeetCodeProblemResponse,
)
from src.services.leetcode_service import LeetCodeService
from src.utils.exceptions import LLMException, ResourceNotFoundException

router = APIRouter(prefix="/leetcode", tags=["leetcode"])


@router.get("/problems/{title_slug}", response_model=LeetCodeProblemResponse)
async def get_problem(
    title_slug: str,
    user: User = Depends(get_current_user),
) -> LeetCodeProblemResponse:
    try:
        return await LeetCodeService().get_problem(title_slug)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Unable to load that LeetCode problem right now.") from exc


@router.post("/hint", response_model=LeetCodeHintResponse)
async def kojo_leetcode_hint(
    body: LeetCodeHintRequest,
    user: User = Depends(get_current_user),
) -> LeetCodeHintResponse:
    try:
        return await LeetCodeService().hint(
            title_slug=body.title_slug,
            title=body.title,
            user_message=body.message,
            user_code=body.user_code,
            provider=body.provider,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
