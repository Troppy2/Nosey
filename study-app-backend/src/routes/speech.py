"""Narration voice for lessons, episodes and notes: text in, mp3 out.

Open to every signed-in, non-guest user (the mock interview /speak route stays
beta-only). Cost is bounded three ways: a fixed voice list, a per-account rate
limit, and a daily per-account character cap.
"""
import hashlib
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from src.dependencies import get_current_user
from src.limiter import limiter
from src.models.user import User
from src.services.quota_service import is_exempt, is_guest
from src.services.speech_service import MAX_TTS_CHARS, SpeechService
from src.utils.exceptions import LLMException, ValidationException

router = APIRouter(prefix="/speech", tags=["speech"])

# af_heart narrates lessons, notes and slide decks, and hosts podcast episodes;
# bm_george is the episode expert. Both probed live against Kokoro.
NARRATION_VOICES = {"af_heart", "bm_george"}

# About twenty full lessons a day. Admins and beta users are exempt, like every other quota.
DAILY_CHAR_CAP = 150_000

# user id -> (day, characters narrated). Per process, so with several instances the
# effective cap is a multiple; it bounds abuse rather than metering exactly.
_used: dict[int, tuple[date, int]] = {}


def _account_key(request: Request) -> str:
    """Rate-limit per account (from the bearer token), not per IP; falls back to the IP."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer ") and len(auth) > 20:
        return "tts:" + hashlib.sha256(auth.encode()).hexdigest()[:24]
    return "tts-ip:" + (request.client.host if request.client else "unknown")


def _charge(user: User, chars: int) -> None:
    today = date.today()
    day, used = _used.get(user.id, (today, 0))
    if day != today:
        used = 0
    if used + chars > DAILY_CHAR_CAP:
        raise HTTPException(status_code=429, detail="Daily narration limit reached. It resets tomorrow.")
    _used[user.id] = (today, used + chars)


class NarrationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TTS_CHARS)
    voice: str = Field(default="af_heart", max_length=32)


@router.post("/tts")
@limiter.limit("90/minute", key_func=_account_key)
async def narrate(
    request: Request,
    payload: NarrationRequest,
    user: User = Depends(get_current_user),
) -> Response:
    if is_guest(user):
        raise HTTPException(status_code=403, detail="Create an account to use narration.")
    if payload.voice not in NARRATION_VOICES:
        raise HTTPException(status_code=400, detail="Unknown voice.")
    if not is_exempt(user):
        _charge(user, len(payload.text))
    try:
        audio = await SpeechService().synthesize(payload.text, payload.voice)
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LLMException:
        # Provider detail stays in the server log; the client only needs to fall back.
        raise HTTPException(status_code=503, detail="Narration is unavailable right now.")
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})
