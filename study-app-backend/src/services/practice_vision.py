"""Read math-heavy practice-test pages with a vision model (GH #133).

A LaTeX PDF draws bracket matrices, big sums and stacked fractions with math
extension fonts and line art, so text extraction returns "(a)" with nothing
after it. For files uploaded as a practice test, the pages that lost math (or
have no text layer at all) are rendered and transcribed to LaTeX by a vision
model, and those transcriptions replace the extracted text of those pages.

Bounded on purpose: at most settings.practice_vision_max_pages pages per file,
three at a time, one Claude vision call each, and only when the uploader still
has practice-vision quota (QuotaService.charge_practice_vision). Never raises:
a failed page keeps its extracted text.
"""
from __future__ import annotations

import asyncio
import base64
import re
from typing import Optional

from src.config import settings
from src.utils.logger import get_logger

try:  # pragma: no cover - import guard mirrors file_service
    import fitz  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore[assignment]

logger = get_logger(__name__)

_CONCURRENCY = 3
# 2x the PDF's 72 dpi: a letter page renders at about 1224x1584, which Claude
# reads comfortably (it downscales past 1568 px on the long edge).
_RENDER_ZOOM = 2.0
# TeX math fonts (Computer Modern / Latin Modern / AMS / STIX). Extension fonts
# draw the brackets, radicals and big operators text extraction cannot place;
# math italic and symbol fonts carry the variables whose subscripts and
# superscripts extraction flattens ("c_{3:12}" comes out as "c 3:12").
_MATH_FONT_RE = re.compile(
    r"cmex|cmmi|cmsy|msam|msbm|euex|mathex|mathitalic|mathsymbols|stix.*(math|ext|size)",
    re.IGNORECASE,
)
_PRIVATE_USE_RE = re.compile("[-]")
# A part label left alone on its line: whatever followed it was drawn, not written.
_BARE_LABEL_RE = re.compile(r"(?m)^\s*\(?[a-h]\)\s*$")

_TRANSCRIBE_PROMPT = (
    "Transcribe this page of a student's practice test or homework exactly.\n"
    "- Keep every question, part label such as (a) or (b), answer option, and answer key entry, in reading "
    "order (finish the left column before the right one).\n"
    "- Write all math in LaTeX: inline math as $...$, and displayed math on a single line as $$...$$. "
    "Vectors and matrices use \\begin{bmatrix}...\\end{bmatrix}. Keep subscripts and superscripts, e.g. "
    "$c_{3:12}$, $w_{t+24}$.\n"
    "- Do not solve anything, do not add commentary, and leave out blank answer lines and page furniture "
    "(headers, footers, page numbers).\n"
    "Output only the transcription."
)


def pages_needing_vision(path: str, page_texts: list[str], max_pages: int) -> list[int]:
    """Indices of pages whose math or text was lost, at most max_pages of them.

    Runs in a worker thread (opens the PDF). Signals, any of which flags a page:
    math extension fonts, private-use glyphs or a bare part label in its
    extracted text, or almost no text on a page that has images (a scan).
    """
    if fitz is None:
        return []
    flagged: list[int] = []
    document = fitz.open(path)
    try:
        for index in range(min(len(page_texts), document.page_count)):
            text = page_texts[index] or ""
            page = document.load_page(index)
            fonts = " ".join(str(font[3]) for font in page.get_fonts())
            scanned = len(text.strip()) < 40 and bool(page.get_images())
            if scanned or _MATH_FONT_RE.search(fonts) or _PRIVATE_USE_RE.search(text) or _BARE_LABEL_RE.search(text):
                flagged.append(index)
                if len(flagged) >= max_pages:
                    break
    finally:
        document.close()
    return flagged


def _render_pages(path: str, indices: list[int]) -> dict[int, str]:
    """Base64 PNGs of the given pages. Runs in a worker thread."""
    images: dict[int, str] = {}
    document = fitz.open(path)
    try:
        for index in indices:
            pixmap = document.load_page(index).get_pixmap(matrix=fitz.Matrix(_RENDER_ZOOM, _RENDER_ZOOM))
            images[index] = base64.b64encode(pixmap.tobytes("png")).decode("ascii")
    finally:
        document.close()
    return images


async def transcribe_math_pages(path: str, page_texts: list[str]) -> dict[int, str]:
    """{page index: LaTeX transcription} for the pages text extraction failed on.

    Empty when nothing needed vision, no vision provider is configured, or every
    call failed. Never raises.
    """
    if fitz is None or not settings.anthropic_api_key or not page_texts:
        return {}
    from src.services.llm_service import LLMService

    try:
        indices = await asyncio.to_thread(
            pages_needing_vision, path, page_texts, settings.practice_vision_max_pages
        )
        if not indices:
            return {}
        images = await asyncio.to_thread(_render_pages, path, indices)
    except Exception as exc:
        logger.warning("Practice-test vision pass could not prepare pages: %s", exc)
        return {}

    gate = asyncio.Semaphore(_CONCURRENCY)
    llm = LLMService()

    async def transcribe(index: int) -> Optional[str]:
        async with gate:
            try:
                text = await llm._complete_vision_anthropic(images[index], "image/png", _TRANSCRIBE_PROMPT)
                return text.strip() or None
            except Exception as exc:
                logger.warning("Vision transcription of page %d failed: %s", index + 1, exc)
                return None

    results = await asyncio.gather(*(transcribe(i) for i in indices))
    done = {i: text for i, text in zip(indices, results) if text}
    logger.info("Practice-test vision pass: %d of %d flagged pages transcribed", len(done), len(indices))
    return done
