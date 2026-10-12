import time

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import async_session_maker, get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.utils.provider_policy import resolve_request_provider
from src.utils.usage_context import bind_usage
from src.schemas.flashcard_schema import (
    FlashcardAttemptCreate,
    FlashcardBulkImportRequest,
    FlashcardCreate,
    FlashcardGenerateRequest,
    FlashcardResponse,
    FlashcardTidyRequest,
    FlashcardTidyResponse,
    FlashcardUpdate,
)
from src.limiter import limiter
from src.services.flashcard_service import FlashcardService
from src.services.quota_service import QuotaService
from src.utils.exceptions import LLMException, ResourceNotFoundException, StudyAppException
from typing import Optional

router = APIRouter(tags=["flashcards"])


async def _settle_flashcard_quota(charge_id: Optional[int], produced: int) -> None:
    """Trim the usage charge to the cards actually produced (0 refunds it).

    Uses its own session: on the failure path the request session may be in a
    rolled-back state. Never raises.
    """
    if charge_id is None:
        return
    try:
        async with async_session_maker() as quota_session:
            await QuotaService().settle_charge(quota_session, charge_id, produced)
    except Exception:
        pass


@router.get("/flashcards", response_model=list[FlashcardResponse])
async def list_all_flashcards(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    return await FlashcardService().list_flashcards_for_user(user.id, session)


@router.post(
    "/folders/{folder_id}/flashcards",
    response_model=FlashcardResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_flashcard(
    folder_id: int,
    data: FlashcardCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FlashcardResponse:
    try:
        return await FlashcardService().create_flashcard(folder_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/folders/{folder_id}/flashcards/import",
    response_model=list[FlashcardResponse],
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
async def import_flashcards(
    request: Request,
    response: Response,
    folder_id: int,
    data: FlashcardBulkImportRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    """Save cards the student reviewed in the Quizlet import modal. No LLM call,
    so no usage charge."""
    try:
        return await FlashcardService().bulk_import(folder_id, user.id, data.cards, data.source, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/flashcards/import/tidy", response_model=FlashcardTidyResponse)
@limiter.limit("5/minute")
async def tidy_flashcard_paste(
    request: Request,
    response: Response,
    data: FlashcardTidyRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FlashcardTidyResponse:
    """Kojo pulls term/definition pairs out of a paste the parser couldn't read.

    Counts toward the Kojo token budget (feature name starts with "kojo_"). The
    gate runs before the try so its 429 is not remapped; the slot is released
    in the finally.
    """
    provider = resolve_request_provider(user, None)
    slot = await QuotaService().acquire_kojo(session, user)
    bind_usage(user.id, "kojo_flashcard_tidy")
    _t0 = time.monotonic()
    try:
        cards = await FlashcardService().tidy_paste(data.text, provider=provider)
        duration_ms = int((time.monotonic() - _t0) * 1000)
        try:
            await UsageEventRepository(session).log_event(
                user.id, "kojo_flashcard_tidy", duration_ms, provider=provider
            )
            await session.commit()
        except Exception:
            pass
        return FlashcardTidyResponse(cards=cards)
    except LLMException as exc:
        duration_ms = int((time.monotonic() - _t0) * 1000)
        try:
            await UsageEventRepository(session).log_event(
                user.id, "kojo_flashcard_tidy", duration_ms, provider=provider,
                success=False, error_type="LLMException",
            )
            await session.commit()
        except Exception:
            pass
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        slot.release()


@router.post("/folders/{folder_id}/flashcards/generate", response_model=list[FlashcardResponse])
@limiter.limit("10/minute")
async def generate_flashcards(
    request: Request,
    response: Response,
    folder_id: int,
    data: FlashcardGenerateRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    provider = resolve_request_provider(user, data.provider)
    # Usage limit: clamps the count to what is left in the window, 429 at zero.
    count, charge_id = await QuotaService().charge_flashcards(session, user, data.count)
    bind_usage(user.id, "flashcard_generation")
    produced = 0
    _t0 = time.monotonic()
    try:
        service = FlashcardService()
        if data.source_type == "test":
            result = await service.generate_from_test(
                folder_id,
                data.test_id or 0,
                user.id,
                count,
                session,
                provider=provider,
                enable_fallback=data.enable_fallback,
            )
        else:
            result = await service.generate_from_prompt(
                folder_id,
                user.id,
                data.prompt or "",
                count,
                session,
                provider=provider,
                enable_fallback=data.enable_fallback,
            )
        duration_ms = int((time.monotonic() - _t0) * 1000)
        try:
            await UsageEventRepository(session).log_event(
                user.id, "flashcard_generation", duration_ms, provider=provider
            )
            await session.commit()
        except Exception:
            pass
        produced = len(result)
        return result
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await _settle_flashcard_quota(charge_id, produced)


@router.get("/folders/{folder_id}/flashcards", response_model=list[FlashcardResponse])
async def list_flashcards(
    folder_id: int,
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    try:
        return await FlashcardService().list_flashcards(
            folder_id, user.id, session, limit=limit, offset=offset or None
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/folders/{folder_id}/flashcards", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_flashcards(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await FlashcardService().delete_all_flashcards(folder_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/folders/{folder_id}/flashcards/weak", response_model=list[FlashcardResponse])
async def weak_flashcards(
    folder_id: int,
    threshold: float = Query(default=0.5, ge=0.0, le=1.0),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    try:
        return await FlashcardService().get_weak_flashcards(folder_id, user.id, threshold, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/flashcards/generate-from-file", response_model=list[FlashcardResponse])
@limiter.limit("10/minute")
async def generate_flashcards_from_file(
    request: Request,
    response: Response,
    folder_id: int,
    notes_files: list[UploadFile] = File(...),
    count: int = Query(default=10, ge=1, le=50),
    provider: Optional[str] = Query(default=None),
    enable_fallback: bool = Query(default=True),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[FlashcardResponse]:
    provider = resolve_request_provider(user, provider)
    # Usage limit: clamps the count to what is left in the window, 429 at zero.
    count, charge_id = await QuotaService().charge_flashcards(session, user, count)
    bind_usage(user.id, "flashcard_generation")
    produced = 0
    _t0 = time.monotonic()
    try:
        result = await FlashcardService().generate_from_file(
            folder_id,
            user.id,
            notes_files,
            count,
            session,
            provider=provider,
            enable_fallback=enable_fallback,
        )
        duration_ms = int((time.monotonic() - _t0) * 1000)
        try:
            await UsageEventRepository(session).log_event(
                user.id, "flashcard_generation", duration_ms, provider=provider
            )
            await session.commit()
        except Exception:
            pass
        produced = len(result)
        return result
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await _settle_flashcard_quota(charge_id, produced)


@router.patch("/folders/{folder_id}/flashcards/{flashcard_id}", response_model=FlashcardResponse)
async def update_flashcard(
    folder_id: int,
    flashcard_id: int,
    data: FlashcardUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FlashcardResponse:
    try:
        return await FlashcardService().update_flashcard(folder_id, flashcard_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/folders/{folder_id}/flashcards/{flashcard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flashcard(
    folder_id: int,
    flashcard_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await FlashcardService().delete_flashcard(folder_id, flashcard_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/flashcards/{flashcard_id}/attempt", response_model=FlashcardResponse)
async def record_flashcard_attempt(
    folder_id: int,
    flashcard_id: int,
    data: FlashcardAttemptCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FlashcardResponse:
    try:
        return await FlashcardService().record_attempt(
            folder_id,
            flashcard_id,
            user.id,
            data.correct,
            data.time_ms,
            session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
