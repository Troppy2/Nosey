"""Shared types for the MCP tool modules (mcp_tools reads, mcp_write_tools writes).

Each tool is a pydantic args model plus an async handler. The args model is
both the advertised JSON Schema and the validator, so the two never drift.
Handlers return a JSON-able dict; StudyAppException subclasses become tool
errors the model can read and recover from.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.folder import Folder
from src.models.user import User
from src.repositories.folder_repository import FolderRepository
from src.utils.exceptions import ResourceNotFoundException, StudyAppException


class ToolInputError(StudyAppException):
    """Bad tool arguments; the message is shown to the model so it can retry."""


@dataclass(frozen=True)
class McpContext:
    user: User
    session: AsyncSession


@dataclass(frozen=True)
class McpTool:
    name: str
    title: str
    description: str
    args: type[BaseModel]
    handler: Callable[[McpContext, Any], Awaitable[dict[str, Any]]]
    read_only: bool = True
    destructive: bool = False

    def describe(self) -> dict[str, Any]:
        schema = self.args.model_json_schema()
        schema.pop("title", None)
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": schema,
            "annotations": {
                "title": self.title,
                "readOnlyHint": self.read_only,
                "destructiveHint": self.destructive,
                "idempotentHint": self.read_only,
                "openWorldHint": False,
            },
        }


class ToolArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


def dump(model: BaseModel) -> dict[str, Any]:
    # Nulls are dropped: a missing key reads the same to a model and every
    # null field is tokens the connecting app pays for on each call.
    return model.model_dump(mode="json", exclude_none=True)


async def owned_folder(ctx: McpContext, folder_id: int) -> Folder:
    folder = await FolderRepository(ctx.session).get_owned(folder_id, ctx.user.id)
    if folder is None:
        raise ResourceNotFoundException("Folder")
    return folder
