"""Write tools for the Nosey MCP connector.

The connected app's model writes the content; these tools validate it
strictly (no LLM re-check), moderate it like any other typed input, and save
it. A validation error comes back as a tool error that says exactly what to
fix, so the model can correct and retry.

Agreed limits (see .claude/todos-features/todo-mcp-connector.md):
- Folders can be created and renamed, NEVER deleted. Deleting a folder is
  something only the user does, in Nosey.
- Every delete tool needs confirm=true.
- Rows made here are tagged created_via="mcp" (flashcards: source="mcp"),
  never shown to users.
"""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import Field, model_validator
from sqlalchemy import func, select, update

from src.config import settings
from src.models.flashcard import Flashcard
from src.models.folder import Folder
from src.models.folder_file import FolderFile
from src.models.frq_answer import FRQAnswer
from src.models.mcq_option import MCQOption
from src.models.question import Question
from src.models.test import Test
from src.repositories.flashcard_repository import FlashcardRepository
from src.repositories.test_repository import TestRepository
from src.schemas.flashcard_schema import IMPORT_MAX_SIDE_CHARS
from src.schemas.folder_schema import FolderCreate, FolderUpdate
from src.schemas.test_schema import TestUpdate
from src.services.account_safety_service import screen_user_input
from src.services.folder_service import FolderService
from src.services.kojo_context_cache import invalidate_folder
from src.services.mcp_tool_base import McpContext, McpTool, ToolArgs, ToolInputError, owned_folder
from src.services.test_service import TestService, validate_answer_input
from src.utils.exceptions import ResourceNotFoundException
from src.utils.validators import MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_TOTAL_SIZE_BYTES

CREATED_VIA = "mcp"
# Moderation feature tag for content_flags, alongside "kojo_chat", "folder", ...
MODERATION_FEATURE = "mcp_write"

MAX_TEXT_CHARS = 20_000
MAX_ITEMS_PER_CALL = 100
MAX_QUESTIONS_PER_CALL = 150
MAX_CARDS_PER_CALL = 500
PART_LABELS = "abcdefghij"

CONFIRM_FIELD = Field(
    description="Must be true. Only delete after the user asked for it in this conversation."
)


def require_confirm(confirm: bool) -> None:
    if confirm is not True:
        raise ToolInputError("Nothing was deleted. Set confirm to true only after the user asked for this delete.")


async def screen(ctx: McpContext, *texts: Optional[str]) -> None:
    """Same moderation as text typed into Nosey (off when no key is set)."""
    await screen_user_input(ctx.user, MODERATION_FEATURE, *texts, serialize=True)


def _test_url(test_id: int) -> str:
    return f"{settings.frontend_url.rstrip('/')}/test/{test_id}"


# ---------------------------------------------------------------- question payloads

class OptionIn(ToolArgs):
    text: str = Field(min_length=1, max_length=2000)
    correct: bool = False


class QuestionIn(ToolArgs):
    type: Literal["MCQ", "TF", "MS", "FRQ"] = Field(
        description="MCQ: one correct option. TF: true/false. MS: select all that apply. FRQ: written answer."
    )
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS, description="Question text. Markdown, LaTeX in $...$.")
    options: list[OptionIn] = Field(
        default_factory=list,
        max_length=8,
        description="MCQ: 2 to 6 options, exactly one correct. MS: 2 to 8 options, one or more correct. "
        "Leave empty for TF and FRQ.",
    )
    correct_answer: Optional[bool] = Field(default=None, description="TF only: whether the statement is true.")
    expected_answer: Optional[str] = Field(
        default=None,
        max_length=MAX_TEXT_CHARS,
        description="FRQ only: the model answer the grader compares the student's answer against.",
    )
    input: Optional[Literal["text", "math", "code"]] = Field(
        default=None,
        description="FRQ only: how the student answers. text = typed prose, math = math keyboard, "
        "code = code editor. Omit to use the test's mode. Mixing inputs makes it a Custom test.",
    )
    code_language: Optional[str] = Field(
        default=None, max_length=50, description="For input=code, e.g. Python, Java. Defaults to the test's language."
    )

    @model_validator(mode="after")
    def _check_shape(self) -> "QuestionIn":
        correct = sum(1 for o in self.options if o.correct)
        if self.type == "MCQ":
            if not 2 <= len(self.options) <= 6 or correct != 1:
                raise ValueError("an MCQ needs 2 to 6 options with exactly one correct")
        elif self.type == "MS":
            if not 2 <= len(self.options) <= 8 or correct < 1:
                raise ValueError("an MS question needs 2 to 8 options with at least one correct")
        elif self.type == "TF":
            if self.correct_answer is None or self.options:
                raise ValueError("a TF question needs correct_answer and no options")
        else:
            if not (self.expected_answer or "").strip() or self.options:
                raise ValueError("an FRQ needs expected_answer and no options")
        if self.type != "FRQ" and (self.input or self.code_language):
            raise ValueError("input and code_language are only for FRQ")
        if self.code_language and self.input != "code":
            raise ValueError("code_language needs input=code")
        return self

    def texts(self) -> list[Optional[str]]:
        return [self.text, self.expected_answer, *(o.text for o in self.options)]


class GroupIn(ToolArgs):
    type: Literal["GROUP"] = Field(description="A multi-part problem: one shared setup, parts (a), (b), ...")
    label: str = Field(default="", max_length=50, description="Optional heading, e.g. 'Problem 3'.")
    setup: str = Field(
        min_length=1, max_length=MAX_TEXT_CHARS, description="The shared setup every part refers to."
    )
    parts: list[QuestionIn] = Field(
        min_length=2, max_length=len(PART_LABELS), description="Parts in order. Each part can be any type and input."
    )

    def texts(self) -> list[Optional[str]]:
        return [self.label, self.setup, *(t for part in self.parts for t in part.texts())]


Item = Annotated[Union[QuestionIn, GroupIn], Field(discriminator="type")]


def _question_count(items: list[Union[QuestionIn, GroupIn]]) -> int:
    return sum(len(i.parts) if isinstance(i, GroupIn) else 1 for i in items)


def _all_texts(items: list[Union[QuestionIn, GroupIn]]) -> list[Optional[str]]:
    return [t for item in items for t in item.texts()]


async def _add_question(
    ctx: McpContext,
    test_id: int,
    q: QuestionIn,
    order: int,
    group_id: Optional[int] = None,
    part_label: Optional[str] = None,
) -> Question:
    question = Question(
        test_id=test_id,
        question_text=q.text,
        question_type=q.type,
        display_order=order,
        group_id=group_id,
        part_label=part_label,
        answer_input=q.input if q.type == "FRQ" else None,
        code_language=q.code_language if q.input == "code" else None,
    )
    ctx.session.add(question)
    await ctx.session.flush()
    if q.type in ("MCQ", "MS"):
        ctx.session.add_all(
            MCQOption(question_id=question.id, option_text=o.text, is_correct=o.correct, display_order=i)
            for i, o in enumerate(q.options, start=1)
        )
    elif q.type == "TF":
        ctx.session.add_all([
            MCQOption(question_id=question.id, option_text="True", is_correct=bool(q.correct_answer), display_order=1),
            MCQOption(question_id=question.id, option_text="False", is_correct=not q.correct_answer, display_order=2),
        ])
    else:
        ctx.session.add(FRQAnswer(question_id=question.id, expected_answer=q.expected_answer or ""))
    return question


async def _write_items(
    ctx: McpContext, test_id: int, items: list[Union[QuestionIn, GroupIn]], start_order: int
) -> list[dict[str, Any]]:
    """Write items in the given order; display_order follows that order."""
    repo = TestRepository(ctx.session)
    order = start_order
    written: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, GroupIn):
            group = await repo.add_question_group(test_id, item.label, item.setup)
            ids = []
            for index, part in enumerate(item.parts):
                order += 1
                question = await _add_question(ctx, test_id, part, order, group.id, PART_LABELS[index])
                ids.append(question.id)
            written.append({"group_id": group.id, "question_ids": ids})
        else:
            order += 1
            question = await _add_question(ctx, test_id, item, order)
            written.append({"question_id": question.id})
    return written


def _check_item_limits(items: list[Union[QuestionIn, GroupIn]]) -> None:
    if _question_count(items) > MAX_QUESTIONS_PER_CALL:
        raise ToolInputError(f"At most {MAX_QUESTIONS_PER_CALL} questions per call. Split it into several calls.")


def _test_type(questions: list[Question]) -> str:
    kinds = {q.question_type == "FRQ" for q in questions}
    if kinds == {True}:
        return "FRQ_only"
    if kinds == {False}:
        return "MCQ_only"
    return "mixed"


# ---------------------------------------------------------------- tests

class CreateTestArgs(ToolArgs):
    folder_id: int = Field(description="Folder id from list_folders or create_folder.")
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    mode: Literal["general", "stem", "coding"] = Field(
        default="general",
        description="The test's default input for FRQs: general = typed text, stem = math keyboard, "
        "coding = code editor. A question's own input overrides it.",
    )
    coding_language: Optional[str] = Field(default=None, max_length=50, description="For mode=coding. Default Python.")
    items: list[Item] = Field(
        min_length=1,
        max_length=MAX_ITEMS_PER_CALL,
        description="Questions and multi-part groups, in the order the student sees them.",
    )


async def create_test(ctx: McpContext, args: CreateTestArgs) -> dict[str, Any]:
    await owned_folder(ctx, args.folder_id)
    _check_item_limits(args.items)
    await screen(ctx, args.title, args.description, *_all_texts(args.items))
    test = Test(
        folder_id=args.folder_id,
        title=args.title.strip(),
        description=args.description,
        test_type="mixed",
        is_math_mode=args.mode == "stem",
        is_coding_mode=args.mode == "coding",
        coding_language=(args.coding_language or "Python") if args.mode == "coding" else args.coding_language,
        created_via=CREATED_VIA,
    )
    ctx.session.add(test)
    await ctx.session.flush()
    written = await _write_items(ctx, test.id, args.items, start_order=0)
    questions = (await ctx.session.scalars(select(Question).where(Question.test_id == test.id))).all()
    test.test_type = _test_type(list(questions))
    await ctx.session.commit()
    return {
        "test_id": test.id,
        "title": test.title,
        "question_count": len(questions),
        "custom_mode": any(q.answer_input for q in questions),
        "items": written,
        "url": _test_url(test.id),
    }


class AddQuestionsArgs(ToolArgs):
    test_id: int = Field(description="Test id from list_tests or create_test.")
    items: list[Item] = Field(min_length=1, max_length=MAX_ITEMS_PER_CALL, description="Appended after the last question.")


async def add_questions(ctx: McpContext, args: AddQuestionsArgs) -> dict[str, Any]:
    repo = TestRepository(ctx.session)
    test = await repo.get_owned(args.test_id, ctx.user.id)
    if test is None:
        raise ResourceNotFoundException("Test")
    _check_item_limits(args.items)
    await screen(ctx, *_all_texts(args.items))
    written = await _write_items(ctx, test.id, args.items, start_order=await repo.get_max_display_order(test.id))
    questions = (await ctx.session.scalars(select(Question).where(Question.test_id == test.id))).all()
    test.test_type = _test_type(list(questions))
    await ctx.session.commit()
    return {"test_id": test.id, "question_count": len(questions), "items": written, "url": _test_url(test.id)}


class EditTestArgs(ToolArgs):
    test_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)


async def edit_test(ctx: McpContext, args: EditTestArgs) -> dict[str, Any]:
    await screen(ctx, args.title, args.description)
    updated = await TestService().update_test(
        args.test_id, ctx.user.id, TestUpdate(title=args.title, description=args.description), ctx.session
    )
    return {"test_id": updated.id, "title": updated.title, "description": updated.description}


class EditQuestionArgs(ToolArgs):
    question_id: int = Field(description="Question id from get_test.")
    text: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TEXT_CHARS)
    options: Optional[list[OptionIn]] = Field(default=None, max_length=8, description="MCQ/MS: replaces all options.")
    correct_answer: Optional[bool] = Field(default=None, description="TF only.")
    expected_answer: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TEXT_CHARS, description="FRQ only.")
    input: Optional[Literal["text", "math", "code"]] = Field(
        default=None, description="FRQ only. Send null explicitly to go back to the test's mode."
    )
    code_language: Optional[str] = Field(default=None, max_length=50)


async def edit_question(ctx: McpContext, args: EditQuestionArgs) -> dict[str, Any]:
    repo = TestRepository(ctx.session)
    question = await repo.get_question_owned(args.question_id, ctx.user.id)
    if question is None:
        raise ResourceNotFoundException("Question")
    qtype = question.question_type
    await screen(ctx, args.text, args.expected_answer, *((o.text for o in args.options) if args.options else ()))

    if args.text is not None:
        question.question_text = args.text
    if args.options is not None:
        correct = sum(1 for o in args.options if o.correct)
        if qtype == "MCQ" and not (2 <= len(args.options) <= 6 and correct == 1):
            raise ToolInputError("An MCQ needs 2 to 6 options with exactly one correct.")
        if qtype == "MS" and not (2 <= len(args.options) <= 8 and correct >= 1):
            raise ToolInputError("An MS question needs 2 to 8 options with at least one correct.")
        if qtype not in ("MCQ", "MS"):
            raise ToolInputError(f"options can only be edited on MCQ and MS questions, not {qtype}.")
        await repo.update_mcq_options(question, [(o.text, o.correct) for o in args.options])
    if args.correct_answer is not None:
        if qtype != "TF":
            raise ToolInputError("correct_answer is only for TF questions.")
        await repo.update_mcq_options(question, [("True", args.correct_answer), ("False", not args.correct_answer)])
    if args.expected_answer is not None:
        if qtype != "FRQ":
            raise ToolInputError("expected_answer is only for FRQ questions.")
        if question.frq_answer is None:
            ctx.session.add(FRQAnswer(question_id=question.id, expected_answer=args.expected_answer))
        else:
            question.frq_answer.expected_answer = args.expected_answer
    fields = args.model_fields_set
    if "input" in fields or "code_language" in fields:
        answer_input = args.input if "input" in fields else question.answer_input
        if "code_language" in fields:
            code_language = args.code_language
        else:
            code_language = question.code_language if answer_input == "code" else None
        if qtype != "FRQ" and answer_input is not None:
            raise ToolInputError("input is only for FRQ questions.")
        validate_answer_input(qtype, answer_input, code_language)
        question.answer_input = answer_input
        question.code_language = code_language if answer_input == "code" else None
    await ctx.session.commit()
    return {"question_id": question.id, "updated": sorted(fields - {"question_id"})}


class EditGroupArgs(ToolArgs):
    test_id: int
    group_id: int = Field(description="group id from get_test (question.group.id).")
    setup: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TEXT_CHARS)
    label: Optional[str] = Field(default=None, max_length=50)


async def edit_question_group(ctx: McpContext, args: EditGroupArgs) -> dict[str, Any]:
    group = await TestRepository(ctx.session).get_group_owned(args.group_id, args.test_id, ctx.user.id)
    if group is None:
        raise ResourceNotFoundException("Problem")
    await screen(ctx, args.setup, args.label)
    if args.setup is not None:
        group.stem = args.setup.strip()
    if args.label is not None:
        group.label = args.label.strip()
    await ctx.session.commit()
    return {"group_id": group.id, "label": group.label, "setup": group.stem}


class DeleteQuestionArgs(ToolArgs):
    question_id: int
    confirm: bool = CONFIRM_FIELD


async def delete_question(ctx: McpContext, args: DeleteQuestionArgs) -> dict[str, Any]:
    require_confirm(args.confirm)
    await TestService().delete_question(args.question_id, ctx.user.id, ctx.session)
    return {"deleted_question_id": args.question_id}


class DeleteTestArgs(ToolArgs):
    test_id: int
    confirm: bool = CONFIRM_FIELD


async def delete_test(ctx: McpContext, args: DeleteTestArgs) -> dict[str, Any]:
    require_confirm(args.confirm)
    await TestService().delete_test(args.test_id, ctx.user.id, ctx.session)
    return {"deleted_test_id": args.test_id}


# ---------------------------------------------------------------- flashcards

class CardIn(ToolArgs):
    front: str = Field(min_length=1, max_length=IMPORT_MAX_SIDE_CHARS)
    back: str = Field(min_length=1, max_length=IMPORT_MAX_SIDE_CHARS)


class CreateFlashcardsArgs(ToolArgs):
    folder_id: int
    cards: list[CardIn] = Field(min_length=1, max_length=MAX_CARDS_PER_CALL)


async def create_flashcards(ctx: McpContext, args: CreateFlashcardsArgs) -> dict[str, Any]:
    await owned_folder(ctx, args.folder_id)
    await screen(ctx, *(t for c in args.cards for t in (c.front, c.back)))
    cards = await FlashcardRepository(ctx.session).create_many(
        args.folder_id, [(c.front.strip(), c.back.strip()) for c in args.cards], CREATED_VIA
    )
    await ctx.session.commit()
    return {"folder_id": args.folder_id, "created": len(cards), "flashcard_ids": [c.id for c in cards]}


async def _owned_card(ctx: McpContext, flashcard_id: int) -> Flashcard:
    card = await ctx.session.scalar(
        select(Flashcard)
        .join(Folder, Folder.id == Flashcard.folder_id)
        .where(Flashcard.id == flashcard_id, Folder.user_id == ctx.user.id)
    )
    if card is None:
        raise ResourceNotFoundException("Flashcard")
    return card


class EditFlashcardArgs(ToolArgs):
    flashcard_id: int
    front: Optional[str] = Field(default=None, min_length=1, max_length=IMPORT_MAX_SIDE_CHARS)
    back: Optional[str] = Field(default=None, min_length=1, max_length=IMPORT_MAX_SIDE_CHARS)


async def edit_flashcard(ctx: McpContext, args: EditFlashcardArgs) -> dict[str, Any]:
    card = await _owned_card(ctx, args.flashcard_id)
    await screen(ctx, args.front, args.back)
    await FlashcardRepository(ctx.session).update(card, args.front or card.front, args.back or card.back)
    await ctx.session.commit()
    return {"flashcard_id": card.id, "front": card.front, "back": card.back}


class DeleteFlashcardsArgs(ToolArgs):
    flashcard_ids: list[int] = Field(min_length=1, max_length=MAX_CARDS_PER_CALL)
    confirm: bool = CONFIRM_FIELD


async def delete_flashcards(ctx: McpContext, args: DeleteFlashcardsArgs) -> dict[str, Any]:
    require_confirm(args.confirm)
    cards = (
        await ctx.session.scalars(
            select(Flashcard)
            .join(Folder, Folder.id == Flashcard.folder_id)
            .where(Flashcard.id.in_(args.flashcard_ids), Folder.user_id == ctx.user.id)
        )
    ).all()
    for card in cards:
        await ctx.session.delete(card)
    await ctx.session.commit()
    deleted = {c.id for c in cards}
    return {"deleted": sorted(deleted), "not_found": [i for i in args.flashcard_ids if i not in deleted]}


# ---------------------------------------------------------------- notes

class AddNoteArgs(ToolArgs):
    folder_id: int
    title: Optional[str] = Field(default=None, max_length=255)
    content: str = Field(min_length=1, description="Plain text or markdown. Use it to save source material.")


async def add_note(ctx: McpContext, args: AddNoteArgs) -> dict[str, Any]:
    """Mirrors POST /folders/{id}/files/text: size caps, duplicate check, cache reset."""
    folder = await owned_folder(ctx, args.folder_id)
    content = args.content.strip()
    if not content:
        raise ToolInputError("Note text cannot be empty.")
    size = len(content.encode("utf-8"))
    if size > MAX_UPLOAD_FILE_SIZE_BYTES:
        raise ToolInputError(f"Note exceeds the {MAX_UPLOAD_FILE_SIZE_BYTES // (1024 * 1024)} MB per-file limit.")
    used = await ctx.session.scalar(
        select(func.coalesce(func.sum(FolderFile.size_bytes), 0)).where(FolderFile.folder_id == folder.id)
    )
    if int(used or 0) + size > MAX_UPLOAD_TOTAL_SIZE_BYTES:
        raise ToolInputError(f"Adding this note would exceed the {MAX_UPLOAD_TOTAL_SIZE_BYTES // (1024 * 1024)} MB folder limit.")
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    duplicate = await ctx.session.scalar(
        select(FolderFile).where(FolderFile.folder_id == folder.id, FolderFile.content_hash == content_hash)
    )
    if duplicate is not None:
        raise ToolInputError(f"Identical content already exists as '{duplicate.file_name}' (note_id {duplicate.id}).")
    await screen(ctx, args.title, content)
    title = (args.title or "").strip()
    if not title:
        first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
        title = first_line[:60] or f"Note - {datetime.now().strftime('%b %d, %Y')}"
    note = FolderFile(
        folder_id=folder.id,
        file_name=title[:255],
        file_type="md",
        size_bytes=size,
        content=content,
        content_hash=content_hash,
        upload_status="ready",
    )
    ctx.session.add(note)
    await ctx.session.commit()
    invalidate_folder(folder.id)
    return {"note_id": note.id, "folder_id": folder.id, "file_name": note.file_name}


class DeleteNoteArgs(ToolArgs):
    note_id: int
    confirm: bool = CONFIRM_FIELD


async def delete_note(ctx: McpContext, args: DeleteNoteArgs) -> dict[str, Any]:
    require_confirm(args.confirm)
    note = await ctx.session.scalar(
        select(FolderFile)
        .join(Folder, Folder.id == FolderFile.folder_id)
        .where(FolderFile.id == args.note_id, Folder.user_id == ctx.user.id)
    )
    if note is None:
        raise ResourceNotFoundException("Note")
    folder_id = note.folder_id
    await ctx.session.delete(note)
    await ctx.session.commit()
    invalidate_folder(folder_id)
    return {"deleted_note_id": args.note_id}


# ---------------------------------------------------------------- folders (create + rename only)

class CreateFolderArgs(ToolArgs):
    name: str = Field(min_length=1, max_length=255)
    subject: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)


async def create_folder(ctx: McpContext, args: CreateFolderArgs) -> dict[str, Any]:
    await screen(ctx, args.name, args.subject, args.description)
    folder = await FolderService().create_folder(
        ctx.user.id, FolderCreate(name=args.name.strip(), subject=args.subject, description=args.description), ctx.session
    )
    await ctx.session.execute(update(Folder).where(Folder.id == folder.id).values(created_via=CREATED_VIA))
    await ctx.session.commit()
    return {"folder_id": folder.id, "name": folder.name}


class RenameFolderArgs(ToolArgs):
    folder_id: int
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    subject: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)


async def rename_folder(ctx: McpContext, args: RenameFolderArgs) -> dict[str, Any]:
    await screen(ctx, args.name, args.subject, args.description)
    folder = await FolderService().update_folder(
        args.folder_id,
        ctx.user.id,
        FolderUpdate(name=args.name, subject=args.subject, description=args.description),
        ctx.session,
    )
    return {"folder_id": folder.id, "name": folder.name, "subject": folder.subject}


# ---------------------------------------------------------------- registry

def _write(name: str, title: str, description: str, args, handler, destructive: bool = False) -> McpTool:
    return McpTool(name, title, description, args, handler, read_only=False, destructive=destructive)


WRITE_TOOLS: tuple[McpTool, ...] = (
    _write(
        "create_folder",
        "Create a folder",
        "Create a study folder. Folders can be created and renamed here but never deleted: only the "
        "user deletes folders, in Nosey.",
        CreateFolderArgs,
        create_folder,
    ),
    _write("rename_folder", "Rename a folder", "Change a folder's name, subject or description.",
           RenameFolderArgs, rename_folder),
    _write(
        "add_note",
        "Save a note",
        "Save text (for example source material from this conversation) as a note in a folder, so "
        "Nosey and its tutor can use it later. Optional: tests and cards never need a note.",
        AddNoteArgs,
        add_note,
    ),
    _write("delete_note", "Delete a note", "Delete one note. Needs confirm=true.", DeleteNoteArgs, delete_note,
           destructive=True),
    _write(
        "create_test",
        "Create a test",
        "Create a practice test from questions you write. items is an ordered list; each item is a "
        "question (MCQ, TF, MS, FRQ) or a GROUP (a multi-part problem with a shared setup and parts "
        "(a), (b), ...). Any order and any mix is fine, e.g. five multi-part problems then one FRQ. "
        "An FRQ can set its own input (text, math, code); mixing inputs makes it a Custom test. "
        "Returns the test's URL to share with the user.",
        CreateTestArgs,
        create_test,
    ),
    _write("add_questions", "Add questions to a test",
           "Append questions or multi-part groups to an existing test, in order.", AddQuestionsArgs, add_questions),
    _write("edit_test", "Edit a test", "Change a test's title or description.", EditTestArgs, edit_test),
    _write(
        "edit_question",
        "Edit a question",
        "Change one question's text, options (MCQ/MS), correct_answer (TF), expected_answer or input (FRQ).",
        EditQuestionArgs,
        edit_question,
    ),
    _write("edit_question_group", "Edit a multi-part setup",
           "Change the shared setup or label of a multi-part problem.", EditGroupArgs, edit_question_group),
    _write("delete_question", "Delete a question", "Delete one question. Needs confirm=true.",
           DeleteQuestionArgs, delete_question, destructive=True),
    _write("delete_test", "Delete a test", "Delete a whole test and its results. Needs confirm=true.",
           DeleteTestArgs, delete_test, destructive=True),
    _write("create_flashcards", "Create flashcards", "Add up to 500 flashcards to a folder.",
           CreateFlashcardsArgs, create_flashcards),
    _write("edit_flashcard", "Edit a flashcard", "Change a flashcard's front or back.",
           EditFlashcardArgs, edit_flashcard),
    _write("delete_flashcards", "Delete flashcards", "Delete flashcards by id. Needs confirm=true.",
           DeleteFlashcardsArgs, delete_flashcards, destructive=True),
)
