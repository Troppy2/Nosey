from __future__ import annotations

import json

from src.utils.exceptions import SerializationError
from src.utils.logger import get_logger

logger = get_logger(__name__)


def safe_serialize_payload(payload: object) -> str:
    if isinstance(payload, str):
        return payload
    try:
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
    except Exception:
        logger.exception("Payload serialization failed; falling back to repr")
        try:
            return repr(payload)
        except Exception as exc:
            raise SerializationError("Payload could not be serialized for LLM provider") from exc
