# No `from __future__ import annotations`: slowapi's @limiter.limit wrapper hides
# this module's globals from FastAPI, so string annotations on a rate-limited
# route stop resolving (see rules-gotchas, GH #138).
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.dependencies import get_beta_user
from src.limiter import limiter
from src.models.user import User
from src.schemas.mock_interview_schema import SavedResumeResponse
from src.services.resume_service import (
    clear_saved_resume,
    extract_resume_text,
    load_saved_resume,
    store_saved_resume,
)
from src.utils.exceptions import ValidationException

logger = logging.getLogger(__name__)

# Its own prefix rather than a path under /mock-interview: that router owns
# GET /mock-interview/{session_id}, whose int converter would 422 on a literal
# segment. Beta-gated like the rest of mock interviews.
router = APIRouter(prefix="/saved-resume", tags=["saved-resume"], dependencies=[Depends(get_beta_user)])


@router.get("", response_model=Optional[SavedResumeResponse])
async def get_saved_resume(
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> Optional[SavedResumeResponse]:
    saved = await load_saved_resume(db, user.id)
    if saved is None:
        return None
    return SavedResumeResponse(
        file_name=saved.file_name,
        updated_at=saved.updated_at.isoformat() if saved.updated_at else None,
        chars=len(saved.text),
    )


@router.put("", response_model=SavedResumeResponse)
@limiter.limit("10/minute")
async def put_saved_resume(
    request: Request,
    response: Response,
    resume_file: Optional[UploadFile] = File(default=None),
    resume_text: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> SavedResumeResponse:
    """Save (or replace) the user's resume from an upload or pasted text. Only the
    extracted text is kept, never the file."""
    try:
        text, file_name = await extract_resume_text(resume_file, resume_text)
    except ValidationException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("saved resume extraction failed: %s", exc)
        raise HTTPException(status_code=400, detail="Could not read that file. Try a PDF or DOCX.") from exc

    saved_at = store_saved_resume(user, text, file_name)
    await db.commit()
    return SavedResumeResponse(file_name=file_name, updated_at=saved_at.isoformat(), chars=len(text))


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_resume(
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_beta_user),
) -> Response:
    clear_saved_resume(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
