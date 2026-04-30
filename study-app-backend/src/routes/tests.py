from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from src.database import get_session
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.test_schema import (
    CreateTestResponse,
    QuestionCreate,
    QuestionEditable,
    QuestionUpdate,
    TestResponse,
    TestSummary,
    TestTakeResponse,
    TestUpdate,
    WeaknessResponse,
)
from src.services.grading_service import GradingService
from src.services.test_service import TestService
from src.utils.exceptions import ResourceNotFoundException, StudyAppException
from src.utils.validators import MAX_UPLOAD_DOCUMENTS

router = APIRouter(tags=["tests"])


@router.post(
    "/folders/{folder_id}/tests",
    response_model=CreateTestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_test(
    folder_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CreateTestResponse:
    try:
        form = await request.form()
        title = str(form.get("title", "")).strip()
        test_type = str(form.get("test_type", "")).strip()
        description_value = form.get("description")
        description = str(description_value).strip() if description_value else None
        notes_files = form.getlist("notes_files") if hasattr(form, "getlist") else []
        practice_test_raw = form.get("practice_test_file")
        practice_test_file = practice_test_raw if isinstance(practice_test_raw, UploadFile) else None

        # count params (advanced mode)
        try:
            count_mcq = max(0, min(50, int(str(form.get("count_mcq", "10")))))
        except (ValueError, TypeError):
            count_mcq = 10
        try:
            count_frq = max(0, min(50, int(str(form.get("count_frq", "5")))))
        except (ValueError, TypeError):
            count_frq = 5
        is_math_mode = str(form.get("is_math_mode", "false")).lower() in ("true", "1", "yes")

        if not title or not test_type:
            raise StudyAppException("title and test_type are required")
        if not notes_files and practice_test_file is None:
            raise StudyAppException("Provide at least one notes document or a practice test file")
        if len(notes_files) > MAX_UPLOAD_DOCUMENTS:
            raise StudyAppException(f"You can upload at most {MAX_UPLOAD_DOCUMENTS} documents")
        valid_files = [f for f in notes_files if isinstance(f, UploadFile)]
        if len(valid_files) != len(notes_files):
            raise StudyAppException("All uploaded documents must be valid files")
        return await TestService().create_test(
            folder_id=folder_id,
            user_id=user.id,
            title=title,
            test_type=test_type,
            notes_files=valid_files,
            session=session,
            description=description,
            count_mcq=count_mcq,
            count_frq=count_frq,
            practice_test_file=practice_test_file,
            is_math_mode=is_math_mode,
        )
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tests", response_model=list[TestSummary])
async def list_all_tests(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[TestSummary]:
    return await TestService().list_tests_for_user(user.id, session)


@router.get("/folders/{folder_id}/tests", response_model=list[TestSummary])
async def list_tests(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[TestSummary]:
    try:
        return await TestService().list_tests(folder_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/tests/{test_id}", response_model=TestTakeResponse)
async def get_test(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TestTakeResponse:
    try:
        return await TestService().get_test_for_taking(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/tests/{test_id}", response_model=TestResponse)
async def update_test(
    test_id: int,
    data: TestUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TestResponse:
    try:
        return await TestService().update_test(test_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await TestService().delete_test(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/tests/{test_id}/progress", response_model=list[WeaknessResponse])
async def get_test_progress(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[WeaknessResponse]:
    try:
        return await GradingService().get_weakness_detection(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/tests/{test_id}/edit", response_model=list[QuestionEditable])
async def get_questions_for_editing(
    test_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[QuestionEditable]:
    try:
        return await TestService().get_questions_for_editing(test_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/tests/{test_id}/questions",
    response_model=QuestionEditable,
    status_code=status.HTTP_201_CREATED,
)
async def add_question(
    test_id: int,
    data: QuestionCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> QuestionEditable:
    try:
        return await TestService().add_question(test_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/tests/{test_id}/questions/{question_id}", response_model=QuestionEditable)
async def update_question(
    test_id: int,
    question_id: int,
    data: QuestionUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> QuestionEditable:
    try:
        return await TestService().update_question(question_id, user.id, data, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except StudyAppException as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/tests/{test_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    test_id: int,
    question_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    try:
        await TestService().delete_question(question_id, user.id, session)
    except ResourceNotFoundException as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
