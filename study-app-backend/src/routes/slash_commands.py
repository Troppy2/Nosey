from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_current_user
from src.models.slash_command import SlashCommand
from src.models.user import User
from src.schemas.slash_command_schema import (
    SlashCommandCreate,
    SlashCommandResponse,
    SlashCommandUpdate,
)

router = APIRouter(prefix="/slash-commands", tags=["slash-commands"])


async def get_user_command(command_id: int, user_id: int, session: AsyncSession) -> SlashCommand:
    result = await session.execute(
        select(SlashCommand).where(
            SlashCommand.id == command_id,
            SlashCommand.user_id == user_id,
        )
    )
    command = result.scalar_one_or_none()
    if command is None:
        raise HTTPException(status_code=404, detail="Slash command not found")
    return command


@router.get("", response_model=list[SlashCommandResponse])
async def list_slash_commands(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[SlashCommandResponse]:
    result = await session.execute(
        select(SlashCommand)
        .where(SlashCommand.user_id == user.id)
        .order_by(SlashCommand.is_pinned.desc(), SlashCommand.position.asc(), SlashCommand.created_at.asc())
    )
    return list(result.scalars().all())


@router.post("", response_model=SlashCommandResponse, status_code=status.HTTP_201_CREATED)
async def create_slash_command(
    data: SlashCommandCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> SlashCommandResponse:
    command = SlashCommand(user_id=user.id, **data.model_dump())
    session.add(command)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="You already have a slash command with that trigger") from exc
    await session.refresh(command)
    return command


@router.patch("/{command_id}", response_model=SlashCommandResponse)
async def update_slash_command(
    command_id: int,
    data: SlashCommandUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> SlashCommandResponse:
    command = await get_user_command(command_id, user.id, session)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(command, key, value)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="You already have a slash command with that trigger") from exc
    await session.refresh(command)
    return command


@router.delete("/{command_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_slash_command(
    command_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    command = await get_user_command(command_id, user.id, session)
    await session.delete(command)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
