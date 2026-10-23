"""Narration voice for lessons, episodes and notes: text in, mp3 out.

Open to every signed-in user (the mock interview /speak route stays beta-only),
so it is rate limited and restricted to a fixed set of voices.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from src.dependencies import get_current_user
from src.limiter import limiter
from src.models.user import User
from src.services.speech_service import MAX_TTS_CHARS, SpeechService
from src.utils.exceptions import LLMException, ValidationException

router = APIRouter(prefix="/speech", tags=["speech"])

# af_heart narrates lessons, notes and slide decks, and hosts podcast episodes;
# bm_george is the episode expert. Both probed live against Kokoro.
NARRATION_VOICES = {"af_heart", "bm_george"}


class NarrationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TTS_CHARS)
    voice: str = Field(default="af_heart", max_length=32)


@router.post("/tts")
@limiter.limit("90/minute")
async def narrate(
    request: Request,
    payload: NarrationRequest,
    user: User = Depends(get_current_user),
) -> Response:
    if payload.voice not in NARRATION_VOICES:
        raise HTTPException(status_code=400, detail="Unknown voice.")
    try:
        audio = await SpeechService().synthesize(payload.text, payload.voice)
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except LLMException as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})
