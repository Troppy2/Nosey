import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, File
from fastapi.responses import StreamingResponse
from typing import AsyncIterator, List
from sqlalchemy.ext.asyncio import AsyncSession


from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.utils.provider_policy import resolve_request_provider
from src.schemas.kojo_schema import (
    ConversationFileDTO,
    KojoActionCardDTO,
    ProposeActionRequest,
    ResolveActionRequest,
    GeneralChatRequest,
    KojoBootstrapDTO,
    KojoChatRequest,
    KojoChatResponse,
    KojoClearResponse,
    KojoClearedConversationDTO,
    KojoConversationDTO,
    KojoConversationSummaryDTO,
    KojoMemoryDTO,
    KojoRestoreResponse,
    RegenerateRequest,
    RenameConversationRequest,
    TestBlueprintRequest,
    TestBlueprintResponse,
)
from src.limiter import limiter
from src.services.kojo_service import KojoService
from src.services.llm_service import LLMService
from src.services.memory_service import MemoryService, is_stale
from src.utils.exceptions import LLMException, ResourceNotFoundException, ValidationException
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/kojo", tags=["kojo"])


@router.get("/providers/status")
async def providers_status(
    user: User = Depends(get_current_user),
) -> dict:
    return await LLMService().check_providers_status()


@router.get("/folders/{folder_id}/conversations", response_model=list[KojoConversationSummaryDTO])
async def list_conversations(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[KojoConversationSummaryDTO]:
    try:
        return await KojoService().list_conversations(
            user_id=user.id, folder_id=folder_id, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/conversations", response_model=KojoConversationSummaryDTO, status_code=201)
async def create_conversation(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoConversationSummaryDTO:
    try:
        return await KojoService().create_conversation(
            user_id=user.id, folder_id=folder_id, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/folders/{folder_id}/bootstrap", response_model=KojoBootstrapDTO)
async def bootstrap_folder(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoBootstrapDTO:
    try:
        return await KojoService().bootstrap_folder(
            user_id=user.id, folder_id=folder_id, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/chat", response_model=KojoChatResponse)
@limiter.limit("20/minute")
async def kojo_chat(
    request: Request,
    response: Response,
    folder_id: int,
    body: KojoChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoChatResponse:
    if user.age is not None and user.age < 15:
        raise HTTPException(status_code=403, detail="Kojo chat is not available for users under 15")
    provider = resolve_request_provider(user, body.provider)
    _t0 = time.monotonic()
    try:
        result = await KojoService().chat(
            user_id=user.id,
            folder_id=folder_id,
            user_message=body.message,
            provider=provider,
            strictness=body.strictness,
            conversation_id=body.conversation_id,
            custom_instruction=body.custom_instruction,
            session=session,
        )
        duration_ms = int((time.monotonic() - _t0) * 1000)
        try:
            await UsageEventRepository(session).log_event(
                user.id, "kojo_chat", duration_ms, provider=provider
            )
            await session.commit()
        except Exception:
            pass
        return result
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        duration_ms = int((time.monotonic() - _t0) * 1000)
        try:
            await UsageEventRepository(session).log_event(
                user.id, "kojo_chat", duration_ms, provider=provider,
                success=False, error_type="LLMException"
            )
            await session.commit()
        except Exception:
            pass
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # disable proxy buffering so deltas flush immediately
}


@router.post("/folders/{folder_id}/chat/stream")
@limiter.limit("20/minute")
async def kojo_chat_stream(
    request: Request,
    response: Response,
    folder_id: int,
    body: KojoChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    if user.age is not None and user.age < 15:
        raise HTTPException(status_code=403, detail="Kojo chat is not available for users under 15")

    provider = resolve_request_provider(user, body.provider)

    async def event_stream() -> AsyncIterator[str]:
        _t0 = time.monotonic()
        success = True
        error_type = None
        try:
            async for event in KojoService().chat_stream(
                user_id=user.id,
                folder_id=folder_id,
                user_message=body.message,
                provider=provider,
                strictness=body.strictness,
                conversation_id=body.conversation_id,
                reasoning=bool(body.reasoning),
                custom_instruction=body.custom_instruction,
                session=session,
            ):
                yield _sse(event)
        except ResourceNotFoundException as exc:
            success = False
            error_type = "ResourceNotFoundException"
            yield _sse({"type": "error", "message": str(exc)})
        except LLMException as exc:
            success = False
            error_type = "LLMException"
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            success = False
            error_type = "Exception"
            yield _sse({"type": "error", "message": "Kojo failed to respond. Try again."})
            logger.warning("Kojo stream unexpected error: %s", exc)
        finally:
            duration_ms = int((time.monotonic() - _t0) * 1000)
            try:
                await UsageEventRepository(session).log_event(
                    user.id, "kojo_chat", duration_ms, provider=provider,
                    success=success, error_type=error_type,
                )
                await session.commit()
            except Exception:
                pass

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/folders/{folder_id}/conversation", response_model=KojoConversationDTO)
async def get_conversation(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoConversationDTO:
    try:
        return await KojoService().get_conversation(
            user_id=user.id,
            folder_id=folder_id,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/clear", response_model=KojoClearResponse)
async def clear_conversation(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoClearResponse:
    try:
        return await KojoService().clear_conversation(
            user_id=user.id,
            folder_id=folder_id,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/restore", response_model=KojoRestoreResponse)
async def restore_conversation(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoRestoreResponse:
    try:
        return await KojoService().restore_conversation(
            user_id=user.id,
            folder_id=folder_id,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/test-blueprint", response_model=TestBlueprintResponse)
async def test_blueprint(
    folder_id: int,
    body: TestBlueprintRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TestBlueprintResponse:
    try:
        return await KojoService().propose_test_blueprint(
            user_id=user.id,
            folder_id=folder_id,
            user_message=body.message,
            provider=resolve_request_provider(user, body.provider),
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/conversation/files", response_model=list[ConversationFileDTO])
async def upload_conversation_files(
    folder_id: int,
    files: List[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[ConversationFileDTO]:
    try:
        return await KojoService().upload_conversation_files(
            user_id=user.id,
            folder_id=folder_id,
            files=files,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/folders/{folder_id}/conversation/files", response_model=list[ConversationFileDTO])
async def list_conversation_files(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[ConversationFileDTO]:
    try:
        return await KojoService().list_conversation_files(
            user_id=user.id,
            folder_id=folder_id,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/folders/{folder_id}/conversation/files/{file_id}", status_code=204)
async def delete_conversation_file(
    folder_id: int,
    file_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await KojoService().delete_conversation_file(
            user_id=user.id,
            folder_id=folder_id,
            file_id=file_id,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/conversations/{conversation_id}/files", response_model=list[ConversationFileDTO])
async def upload_conversation_files_by_id(
    conversation_id: int,
    files: List[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[ConversationFileDTO]:
    try:
        return await KojoService().upload_conversation_files_by_id(
            user_id=user.id, conversation_id=conversation_id, files=files, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/conversations/{conversation_id}/files", response_model=list[ConversationFileDTO])
async def list_conversation_files_by_id(
    conversation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[ConversationFileDTO]:
    try:
        return await KojoService().list_conversation_files_by_id(
            user_id=user.id, conversation_id=conversation_id, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/conversations/{conversation_id}/files/{file_id}", status_code=204)
async def delete_conversation_file_by_id(
    conversation_id: int,
    file_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await KojoService().delete_conversation_file_by_id(
            user_id=user.id, conversation_id=conversation_id, file_id=file_id, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/conversations/general", response_model=list[KojoConversationSummaryDTO])
async def list_general_conversations(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[KojoConversationSummaryDTO]:
    return await KojoService().list_general_conversations(user_id=user.id, session=session)


@router.post("/conversations/general", response_model=KojoConversationSummaryDTO, status_code=201)
async def create_general_conversation(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoConversationSummaryDTO:
    return await KojoService().create_general_conversation(user_id=user.id, session=session)


@router.get("/conversations/general/bootstrap", response_model=KojoBootstrapDTO)
async def bootstrap_general(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoBootstrapDTO:
    return await KojoService().bootstrap_general(user_id=user.id, session=session)


@router.post("/conversations/{conversation_id}/chat", response_model=KojoChatResponse)
@limiter.limit("20/minute")
async def general_chat(
    request: Request,
    response: Response,
    conversation_id: int,
    body: GeneralChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoChatResponse:
    try:
        return await KojoService().general_chat(
            user_id=user.id,
            conversation_id=conversation_id,
            user_message=body.message,
            provider=resolve_request_provider(user, body.provider),
            strictness=body.strictness,
            custom_instruction=body.custom_instruction,
            context=body.context,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/conversations/{conversation_id}/chat/stream")
@limiter.limit("20/minute")
async def general_chat_stream(
    request: Request,
    response: Response,
    conversation_id: int,
    body: GeneralChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    provider = resolve_request_provider(user, body.provider)

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in KojoService().general_chat_stream(
                user_id=user.id,
                conversation_id=conversation_id,
                user_message=body.message,
                provider=provider,
                strictness=body.strictness,
                reasoning=bool(body.reasoning),
                custom_instruction=body.custom_instruction,
                context=body.context,
                session=session,
            ):
                yield _sse(event)
        except ResourceNotFoundException as exc:
            yield _sse({"type": "error", "message": str(exc)})
        except LLMException as exc:
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "message": "Kojo failed to respond. Try again."})
            logger.warning("Kojo general stream unexpected error: %s", exc)

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/conversations/{conversation_id}/regenerate/stream")
@limiter.limit("20/minute")
async def regenerate_stream(
    request: Request,
    response: Response,
    conversation_id: int,
    body: RegenerateRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    if user.age is not None and user.age < 15:
        raise HTTPException(status_code=403, detail="Kojo chat is not available for users under 15")

    provider = resolve_request_provider(user, body.provider)

    async def event_stream() -> AsyncIterator[str]:
        _t0 = time.monotonic()
        success = True
        error_type = None
        try:
            async for event in KojoService().regenerate_stream(
                user_id=user.id,
                conversation_id=conversation_id,
                provider=provider,
                strictness=body.strictness,
                reasoning=bool(body.reasoning),
                custom_instruction=body.custom_instruction,
                session=session,
            ):
                yield _sse(event)
        except ResourceNotFoundException as exc:
            success = False
            error_type = "ResourceNotFoundException"
            yield _sse({"type": "error", "message": str(exc)})
        except LLMException as exc:
            success = False
            error_type = "LLMException"
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            success = False
            error_type = "Exception"
            yield _sse({"type": "error", "message": "Kojo failed to regenerate a response. Try again."})
            logger.warning("Kojo regenerate stream unexpected error: %s", exc)
        finally:
            duration_ms = int((time.monotonic() - _t0) * 1000)
            try:
                await UsageEventRepository(session).log_event(
                    user.id, "kojo_regenerate", duration_ms, provider=provider,
                    success=success, error_type=error_type,
                )
                await session.commit()
            except Exception:
                pass

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/memory", response_model=KojoMemoryDTO)
async def get_memory(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoMemoryDTO:
    memory = await MemoryService().get(user.id, session)
    return KojoMemoryDTO(
        content=memory.content if memory else None,
        generated_at=memory.generated_at if memory else None,
        stale=is_stale(memory),
    )


@router.post("/memory/refresh", response_model=KojoMemoryDTO)
@limiter.limit("6/minute")
async def refresh_memory(
    request: Request,
    response: Response,
    force: bool = False,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoMemoryDTO:
    provider = resolve_request_provider(user, None)
    memory = await MemoryService().ensure_fresh(user.id, session, provider=provider, force=force)
    return KojoMemoryDTO(
        content=memory.content or None,
        generated_at=memory.generated_at,
        stale=is_stale(memory),
    )


@router.post("/conversations/{conversation_id}/action-cards", response_model=KojoActionCardDTO, status_code=201)
@limiter.limit("20/minute")
async def propose_action_card(
    request: Request,
    response: Response,
    conversation_id: int,
    body: ProposeActionRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoActionCardDTO:
    try:
        return await KojoService().propose_action(
            user_id=user.id,
            conversation_id=conversation_id,
            action_type=body.action_type,
            user_message=body.message,
            provider=resolve_request_provider(user, body.provider),
            message_id=body.message_id,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/conversations/{conversation_id}/action-cards", response_model=list[KojoActionCardDTO])
async def list_action_cards(
    conversation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[KojoActionCardDTO]:
    try:
        return await KojoService().list_action_cards(
            user_id=user.id, conversation_id=conversation_id, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/action-cards/{card_id}", response_model=KojoActionCardDTO)
async def resolve_action_card(
    card_id: int,
    body: ResolveActionRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoActionCardDTO:
    try:
        return await KojoService().resolve_action(
            user_id=user.id,
            card_id=card_id,
            status=body.status,
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            payload_update=body.payload,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/conversations/cleared", response_model=list[KojoClearedConversationDTO])
async def get_cleared_conversations(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[KojoClearedConversationDTO]:
    return await KojoService().get_cleared_conversations(user_id=user.id, session=session)


@router.get("/conversations/{conversation_id}", response_model=KojoConversationDTO)
async def get_conversation_by_id(
    conversation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoConversationDTO:
    try:
        return await KojoService().get_conversation_detail(
            user_id=user.id, conversation_id=conversation_id, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/conversations/{conversation_id}", response_model=KojoConversationSummaryDTO)
async def rename_conversation(
    conversation_id: int,
    body: RenameConversationRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoConversationSummaryDTO:
    try:
        return await KojoService().rename_conversation(
            user_id=user.id,
            conversation_id=conversation_id,
            name=body.name,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await KojoService().delete_conversation(
            user_id=user.id, conversation_id=conversation_id, session=session
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
