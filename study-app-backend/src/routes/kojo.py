from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
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
async def kojo_chat(
    folder_id: int,
    body: KojoChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> KojoChatResponse:
    try:
        return await KojoService().chat(
            user_id=user.id,
            folder_id=folder_id,
            user_message=body.message,
            provider=body.provider,
            strictness=body.strictness,
            conversation_id=body.conversation_id,
            session=session,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LLMException as exc:
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
async def general_chat(
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
