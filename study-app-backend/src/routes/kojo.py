import time

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.repositories.usage_event_repository import UsageEventRepository
from src.schemas.kojo_schema import (
    ConversationFileDTO,
    GeneralChatRequest,
    KojoChatRequest,
    KojoChatResponse,
    KojoClearResponse,
    KojoClearedConversationDTO,
    KojoConversationDTO,
    KojoConversationSummaryDTO,
    KojoRestoreResponse,
    TestBlueprintRequest,
    TestBlueprintResponse,
)
from src.limiter import limiter
from src.services.kojo_service import KojoService
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ResourceNotFoundException

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


@router.post("/folders/{folder_id}/chat", response_model=KojoChatResponse)
@limiter.limit("20/minute")
async def kojo_chat(
    request: Request,
    folder_id: int,
    body: KojoChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoChatResponse:
    if user.age is not None and user.age < 15:
        raise HTTPException(status_code=403, detail="Kojo chat is not available for users under 15")
    _t0 = time.monotonic()
    try:
        result = await KojoService().chat(
            user_id=user.id,
            folder_id=folder_id,
            user_message=body.message,
            provider=body.provider,
            strictness=body.strictness,
            conversation_id=body.conversation_id,
            session=session,
        )
        duration_ms = int((time.monotonic() - _t0) * 1000)
        try:
            await UsageEventRepository(session).log_event(
                user.id, "kojo_chat", duration_ms, provider=body.provider
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
                user.id, "kojo_chat", duration_ms, provider=body.provider,
                success=False, error_type="LLMException"
            )
            await session.commit()
        except Exception:
            pass
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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
            provider=body.provider,
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


@router.post("/conversations/{conversation_id}/chat", response_model=KojoChatResponse)
@limiter.limit("20/minute")
async def general_chat(
    request: Request,
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
            provider=body.provider,
            strictness=body.strictness,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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
