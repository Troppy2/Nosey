import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, File
from fastapi.responses import StreamingResponse
from typing import AsyncIterator, List
from sqlalchemy.ext.asyncio import AsyncSession


from src.database import get_session
from src.services.account_safety_service import screen_user_input
from src.dependencies import get_current_user
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.utils.provider_policy import resolve_request_provider, user_can_override_provider
from src.utils.usage_context import bind_usage
from src.schemas.kojo_schema import (
    BulkDeleteConversationsRequest,
    BulkDeleteConversationsResponse,
    ConversationFileDTO,
    KojoActionCardDTO,
    ProposeActionRequest,
    ResolveActionRequest,
    GeneralChatRequest,
    KojoActionConfirmRequest,
    KojoActionConfirmResponse,
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
from src.services.quota_service import KojoSlot, QuotaService
from src.utils.exceptions import LLMException, ResourceNotFoundException, ValidationException
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/kojo", tags=["kojo"])


async def _kojo_gate(session: AsyncSession, user: User, feature: str) -> KojoSlot:
    """Enforce the Kojo limits and attribute this request's LLM tokens to
    `feature` (must start with "kojo_" to count, see KOJO_FEATURE_PREFIX).

    SECURITY: returns an in-flight slot (429 when the user or device already
    has too many Kojo requests running, or the token budget is spent). The
    caller MUST release it when the answer is done: in a finally for plain
    routes, in the stream generator's finally for SSE routes.
    """
    slot = await QuotaService().acquire_kojo(session, user)
    bind_usage(user.id, feature)
    return slot


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
    # GH #173: screened before the quota gate and any AI call.
    await screen_user_input(user, "kojo_chat", body.message, body.custom_instruction)
    slot = await _kojo_gate(session, user, "kojo_chat")
    try:
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
    finally:
        slot.release()


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
    # GH #173: screened before the quota gate and any AI call.
    await screen_user_input(user, "kojo_chat", body.message, body.custom_instruction)
    slot = await _kojo_gate(session, user, "kojo_chat")

    async def event_stream() -> AsyncIterator[str]:
        bind_usage(user.id, "kojo_chat")
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
            slot.release()
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
@limiter.limit("20/minute")
async def test_blueprint(
    request: Request,
    response: Response,
    folder_id: int,
    body: TestBlueprintRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TestBlueprintResponse:
    # GH #173: screened before the quota gate and any AI call.
    await screen_user_input(user, "kojo_action", body.message)
    slot = await _kojo_gate(session, user, "kojo_action")
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
    finally:
        slot.release()


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
    # GH #173: screened before the quota gate and any AI call.
    await screen_user_input(user, "kojo_general", body.message, body.custom_instruction, body.context)
    slot = await _kojo_gate(session, user, "kojo_general")
    try:
        _t0 = time.monotonic()
        try:
            result = await KojoService().general_chat(
                user_id=user.id,
                conversation_id=conversation_id,
                user_message=body.message,
                provider=resolve_request_provider(user, body.provider),
                strictness=body.strictness,
                custom_instruction=body.custom_instruction,
                context=body.context,
                interviewer_mode=body.interviewer_mode,
                test_id=body.test_id,
                question_id=body.question_id,
                session=session,
            )
            try:
                await UsageEventRepository(session).log_event(
                    user.id, "kojo_general", int((time.monotonic() - _t0) * 1000),
                    provider=resolve_request_provider(user, body.provider),
                )
                await session.commit()
            except Exception:
                pass
            return result
        except ResourceNotFoundException as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except LLMException as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        slot.release()


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
    # GH #173: screened before the quota gate and any AI call.
    await screen_user_input(user, "kojo_general", body.message, body.custom_instruction, body.context)
    slot = await _kojo_gate(session, user, "kojo_general")
    # Kojo tools (GH #205): beta only, and only in the plain study chat (no
    # KojoCode persona, no in-test question, no caller-supplied context).
    tools_on = (
        bool(body.tools) and user_can_override_provider(user) and not body.interviewer_mode
        and body.test_id is None and body.question_id is None and not (body.context or "").strip()
    )
    tools_user = user if tools_on else None

    async def event_stream() -> AsyncIterator[str]:
        bind_usage(user.id, "kojo_general")
        _t0 = time.monotonic()
        success = True
        error_type = None
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
                interviewer_mode=body.interviewer_mode,
                test_id=body.test_id,
                question_id=body.question_id,
                session=session,
                tools_user=tools_user,
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
            logger.warning("Kojo general stream unexpected error: %s", exc)
        finally:
            slot.release()
            duration_ms = int((time.monotonic() - _t0) * 1000)
            try:
                await UsageEventRepository(session).log_event(
                    user.id, "kojo_general", duration_ms, provider=provider,
                    success=success, error_type=error_type,
                )
                await session.commit()
            except Exception:
                pass

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
    # GH #173: screened before the quota gate and any AI call.
    await screen_user_input(user, "kojo_regenerate", body.custom_instruction)
    slot = await _kojo_gate(session, user, "kojo_regenerate")

    async def event_stream() -> AsyncIterator[str]:
        bind_usage(user.id, "kojo_regenerate")
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
            slot.release()
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
    bind_usage(user.id, "memory_refresh")
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
    # GH #173: screened before the quota gate and any AI call.
    await screen_user_input(user, "kojo_action", body.message)
    slot = await _kojo_gate(session, user, "kojo_action")
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
    finally:
        slot.release()


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


@router.post("/conversations/bulk-delete", response_model=BulkDeleteConversationsResponse)
async def bulk_delete_conversations(
    body: BulkDeleteConversationsRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> BulkDeleteConversationsResponse:
    deleted = await KojoService().bulk_delete_conversations(
        user_id=user.id, conversation_ids=body.ids, session=session
    )
    return BulkDeleteConversationsResponse(deleted=deleted)


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


@router.post("/actions/confirm", response_model=KojoActionConfirmResponse)
@limiter.limit("20/minute")
async def confirm_kojo_action(
    request: Request,
    response: Response,
    body: KojoActionConfirmRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoActionConfirmResponse:
    """Run a write/delete tool Kojo proposed, after the student confirmed its
    card (GH #205). The HMAC token is the only source of the tool and args, so
    nothing the client sends can change what runs."""
    import hashlib

    from limits import parse as parse_limit

    from src.services import kojo_tools
    from src.repositories.kojo_repository import KojoRepository
    from src.services.mcp_tool_base import McpContext

    if not user_can_override_provider(user):
        raise HTTPException(status_code=403, detail="This feature is only available to beta users.")
    data = kojo_tools.verify_action(body.token, user.id)
    if data is None or kojo_tools.kind_of(data.get("n", "")) not in ("write", "delete"):
        raise HTTPException(status_code=400, detail="This card expired. Ask Kojo again.")
    # Single use: a double click or replay inside the 10 minutes must not run it twice.
    digest = hashlib.sha256(body.token.encode()).hexdigest()
    if not limiter.limiter.hit(parse_limit("1 per 15 minutes"), "kojo-confirm", digest):
        raise HTTPException(status_code=409, detail="Already done.")
    name, args, conversation_id = data["n"], data["a"], int(data["c"])
    user_id = user.id
    ctx = McpContext(user=user, session=session)
    title, _lines = await kojo_tools.describe(ctx, name, args)
    bind_usage(user_id, "kojo_action")
    result, is_error = await kojo_tools.run_tool(ctx, name, args)
    if is_error:
        raise HTTPException(status_code=400, detail=str(result.get("error") or "That didn't work."))
    url = result.get("url") if isinstance(result.get("url"), str) else None
    if url and url.startswith("http"):
        url = None  # in-app paths only; MCP tools return absolute share links
    done = title.rstrip("?")
    message = f"Done: {done[0].lower() + done[1:] if done else 'finished'}."
    if name == "generate_test":
        message = f"Started: {done[0].lower() + done[1:]}. It'll be ready in a minute."
    message_id = None
    try:
        repo = KojoRepository(session)
        conversation = await repo.get_conversation_by_id(conversation_id, user_id)
        if conversation is not None:
            message_id = (await repo.add_message(conversation.id, "assistant", message)).id
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - the action already ran; the note is best-effort
        logger.warning("Kojo confirm note failed: %s", exc)
    return KojoActionConfirmResponse(ok=True, message=message, message_id=message_id, url=url)
