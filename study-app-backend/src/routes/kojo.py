from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.kojo_schema import (
    KojoChatRequest,
    KojoChatResponse,
    KojoClearResponse,
    KojoClearedConversationDTO,
    KojoConversationDTO,
    KojoRestoreResponse,
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


@router.get("/conversations/cleared", response_model=list[KojoClearedConversationDTO])
async def get_cleared_conversations(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[KojoClearedConversationDTO]:
    return await KojoService().get_cleared_conversations(user_id=user.id, session=session)
