from typing import Literal

from pydantic import BaseModel


class FolderSearchResult(BaseModel):
    kind: Literal["folder", "test"]
    id: int
    title: str
    folder_id: int
    folder_name: str | None = None
    # Folder rows only: the subject shown under the name, as on the Folders page.
    subject: str | None = None


class FolderSearchResponse(BaseModel):
    results: list[FolderSearchResult]
    has_more: bool = False
