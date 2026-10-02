"""Vision pass for math-heavy practice-test pages (GH #133)."""
from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from src.config import settings
from src.models.folder_file import FolderFile
from src.models.user import User
from src.routes import folder_files
from src.services import practice_vision
from src.services.file_service import ExtractionResult, FileService, assemble_pdf_pages
from src.services.quota_service import QuotaService
from src.utils.usage_context import bind_usage

DEVICE = "11111111-1111-4111-8111-111111111111"


def _pdf(tmp_path: Path, pages: list[str]) -> str:
    doc = fitz.open()
    for text in pages:
        doc.new_page().insert_textbox(fitz.Rect(40, 40, 560, 800), text, fontsize=11)
    path = tmp_path / "exam.pdf"
    doc.save(path)
    return str(path)


# --- which pages ---------------------------------------------------------------------


def test_a_page_with_a_bare_part_label_is_flagged(tmp_path) -> None:
    path = _pdf(tmp_path, ["1. Prose question with all its words.", "2. Which is true?\n(a)\n(b)"])
    texts = ["1. Prose question with all its words.", "2. Which is true?\n(a)\n(b)"]
    assert practice_vision.pages_needing_vision(path, texts, max_pages=20) == [1]


def test_flagged_pages_are_capped(tmp_path) -> None:
    texts = ["(a)"] * 5
    path = _pdf(tmp_path, texts)
    assert practice_vision.pages_needing_vision(path, texts, max_pages=2) == [0, 1]


async def test_no_vision_key_means_no_calls(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    path = _pdf(tmp_path, ["(a)"])
    assert await practice_vision.transcribe_math_pages(path, ["(a)"]) == {}


# --- assembling ------------------------------------------------------------------------


def test_transcriptions_survive_the_line_filters() -> None:
    """Short LaTeX lines repeat on every page; the header filter must not see them."""
    matrix = "$$\\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix}$$\n\\end{bmatrix}\n\\end{bmatrix}\n\\end{bmatrix}\n\\end{bmatrix}"
    pages = ["Exam header line\n1. Text question here?", "(a)", "Exam header line\n2. Another question here?"]
    out = assemble_pdf_pages(pages, {1: matrix})
    assert matrix in out
    assert "1. Text question here?" in out and "2. Another question here?" in out
    assert "NOSEY-VISION-PAGE" not in out


# --- quota -------------------------------------------------------------------------------


async def _user(session, email: str, **kwargs) -> User:
    user = User(email=email, google_id=f"g-{email}", **kwargs)
    session.add(user)
    await session.commit()
    return user


async def test_quota_blocks_guests_exempts_beta_and_caps_everyone_else(db_session_maker, monkeypatch) -> None:
    monkeypatch.setattr(settings, "usage_limits_enabled", True)
    monkeypatch.setattr(settings, "practice_vision_limit_per_window", 2)
    bind_usage(None, None, device_id=DEVICE)
    async with db_session_maker() as session:
        guest = await _user(session, "g1@nosey.guest")
        beta = await _user(session, "b@x.com", is_beta=True)
        regular = await _user(session, "r@x.com")
        svc = QuotaService()

        assert await svc.charge_practice_vision(session, guest) == (False, None)
        assert await svc.charge_practice_vision(session, beta) == (True, None)
        first = await svc.charge_practice_vision(session, regular)
        second = await svc.charge_practice_vision(session, regular)
        assert first[0] and second[0] and first[1] is not None
        assert await svc.charge_practice_vision(session, regular) == (False, None)

        await svc.refund(session, first[1])
        assert (await svc.charge_practice_vision(session, regular))[0] is True


# --- background parse --------------------------------------------------------------------


async def _row(db_session_maker) -> int:
    async with db_session_maker() as session:
        row = FolderFile(
            folder_id=1, file_name="exam.pdf", file_type="pdf", size_bytes=1,
            content="", content_hash="", upload_status="processing",
        )
        session.add(row)
        await session.commit()
        return row.id


@pytest.fixture
def background(monkeypatch, db_session_maker, tmp_path):
    monkeypatch.setattr(folder_files, "async_session_maker", db_session_maker)
    refunds: list = []

    async def fake_refund(charge_id):
        refunds.append(charge_id)

    monkeypatch.setattr(folder_files, "_refund_vision", fake_refund)

    async def fake_extract(self, path, file_name, *, on_progress=None, start_page=0, max_pages=0):
        return ExtractionResult("1. Text?\n(a)", "pdf", 2, 2, ("1. Text?", "(a)"))

    monkeypatch.setattr(FileService, "extract_from_path", fake_extract)
    path = tmp_path / "nosey-upload-x.pdf"
    path.write_bytes(b"%PDF-1.4")
    return refunds, str(path)


async def test_vision_transcription_replaces_the_broken_page(background, db_session_maker, monkeypatch) -> None:
    refunds, path = background

    async def fake_transcribe(p, page_texts):
        return {1: "(a) $\\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix}$"}

    monkeypatch.setattr(folder_files, "transcribe_math_pages", fake_transcribe)
    file_id = await _row(db_session_maker)

    await folder_files._extract_and_update(file_id, path, "exam.pdf", 1, 1, vision_charge=9, use_vision=True)

    async with db_session_maker() as session:
        row = await session.get(FolderFile, file_id)
    assert row.upload_status == "ready"
    assert "\\begin{bmatrix}" in row.content and "1. Text?" in row.content
    assert refunds == []


async def test_no_page_needing_vision_refunds_the_charge(background, db_session_maker, monkeypatch) -> None:
    refunds, path = background

    async def nothing(p, page_texts):
        return {}

    monkeypatch.setattr(folder_files, "transcribe_math_pages", nothing)
    file_id = await _row(db_session_maker)

    await folder_files._extract_and_update(file_id, path, "exam.pdf", 1, 1, vision_charge=9, use_vision=True)

    assert refunds == [9]
