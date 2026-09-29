"""Stream uploads to temp files so a background parse never holds the raw bytes.

Render's free tier has 512 MB of RAM, so a 40 MB upload kept in memory for the
whole background parse is too expensive. Starlette already spools each upload to
disk; this copies it to a file we own (Starlette closes its copy once the response
is sent) and hashes it on the way.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
from dataclasses import dataclass
from typing import Optional

from fastapi import UploadFile

from src.utils.exceptions import ValidationException

TEMP_UPLOAD_PREFIX = "nosey-upload-"
_CHUNK_BYTES = 1024 * 1024


class UploadTooLargeError(ValidationException):
    pass


@dataclass
class SavedUpload:
    path: str
    size: int
    sha256: str


def _write_chunk(handle, hasher, chunk: bytes) -> None:
    hasher.update(chunk)
    handle.write(chunk)


async def save_upload_to_temp(upload: UploadFile, max_bytes: int) -> SavedUpload:
    """Copy an upload to a temp file in 1 MB chunks, hashing it as it goes.

    Raises UploadTooLargeError (after deleting the partial file) past max_bytes.
    The caller owns the returned file and must remove_temp() it.
    """
    suffix = os.path.splitext(upload.filename or "")[1][:16]
    handle = tempfile.NamedTemporaryFile(prefix=TEMP_UPLOAD_PREFIX, suffix=suffix, delete=False)
    hasher = hashlib.sha256()
    size = 0
    try:
        with handle:
            while chunk := await upload.read(_CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    raise UploadTooLargeError(f"Upload exceeds {max_bytes} bytes")
                # Hashing and disk writes run off the event loop: on 0.1 CPU a 40 MB
                # file would otherwise stall every other request for a while.
                await asyncio.to_thread(_write_chunk, handle, hasher, chunk)
    except BaseException:
        remove_temp(handle.name)
        raise
    return SavedUpload(path=handle.name, size=size, sha256=hasher.hexdigest())


def remove_temp(path: Optional[str]) -> None:
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
