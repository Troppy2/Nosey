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
import io
import math
import re
import warnings
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
# A PDF page can declare up to 14400x14400 pt, which at 2x is a 3.3 GB pixmap
# and kills the 512 MB instance (GH #171). Pages are rendered at whatever zoom
# keeps them under this many pixels; a normal letter page at 2x is ~1.9 MP, so
# only oversized pages are ever scaled down.
_RENDER_MAX_PIXELS = 8_000_000
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


def _render_zoom(width_pt: float, height_pt: float) -> float:
    """_RENDER_ZOOM, reduced so the rendered page stays under _RENDER_MAX_PIXELS."""
    area = max(width_pt, 1.0) * max(height_pt, 1.0)
    # 0.995: MuPDF rounds the pixel box up, which can push an exact fit over.
    return min(_RENDER_ZOOM, 0.995 * math.sqrt(_RENDER_MAX_PIXELS / area))


def _render_pages(path: str, indices: list[int]) -> dict[int, str]:
    """Base64 PNGs of the given pages. Runs in a worker thread."""
    images: dict[int, str] = {}
    document = fitz.open(path)
    try:
        for index in indices:
            page = document.load_page(index)
            zoom = _render_zoom(page.rect.width, page.rect.height)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
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


# Long edge of an uploaded photo sent to the vision model. Phone photos are
# 4000+ px and several MB, past the providers' image limits.
_IMAGE_MAX_EDGE = 2000
# Decoding is width x height x 4 bytes no matter how small the file is: a 60 KB
# PNG can declare 40000x40000 px and decode to 6 GB (GH #171). 40 MP covers
# phone photos (12-24 MP, some 48 MP modes excepted) at ~160 MB peak.
_IMAGE_MAX_PIXELS = 40_000_000
_IMAGE_TOO_LARGE = "That image is too large to read. Try a smaller photo (under 40 megapixels)."
_IMAGE_FORMATS = {"PNG", "JPEG"}


_IMAGE_TRANSCRIBE_PROMPT = (
    "Transcribe this image exactly. It is a photo or scan from a student's studies: notes, a practice test, "
    "homework, or an answer sheet / mark scheme, printed or handwritten.\n"
    "- Keep every heading, question, part label such as (a) or (b), answer option, answer, worked step and "
    "marking point (for example \"1 mark for ...\"), in reading order (finish the left column before the "
    "right one).\n"
    "- Write all math in LaTeX: inline math as $...$, and displayed math on a single line as $$...$$. Keep "
    "subscripts and superscripts.\n"
    "- Describe a diagram or graph in one short bracketed line, e.g. [Graph: y = x^2, vertex at (0, 0)].\n"
    "- Do not solve anything and do not add commentary. Leave out words you cannot read rather than guess.\n"
    "Output only the transcription."
)


_IMAGE_UNREADABLE = "That image could not be opened. Try a PNG or JPG."


def _image_jpeg_b64(path: str) -> str:
    """The image as a base64 JPEG, scaled down to _IMAGE_MAX_EDGE. Runs in a worker thread.

    One parser end to end (GH #171). The size check and the decode both run in
    Pillow on the same open file: when one library checked the header and
    another (MuPDF) decoded the pixels, a file the two read differently could
    pass the check and still decode huge. Image.open reads only the header, so
    an oversized image is refused before any pixel is decoded. Pillow's own
    decompression-bomb guard is promoted to an error as a second net.
    """
    from PIL import Image, ImageOps

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(path) as img:
                if img.format not in _IMAGE_FORMATS:
                    raise ValueError(_IMAGE_UNREADABLE)
                width, height = img.size
                if width * height > _IMAGE_MAX_PIXELS:
                    raise ValueError(_IMAGE_TOO_LARGE)
                # JPEG can decode straight at a reduced scale (1/2, 1/4, 1/8),
                # so a 48 MP photo never needs its full-size pixels in memory.
                img.draft("RGB", (_IMAGE_MAX_EDGE, _IMAGE_MAX_EDGE))
                img.load()
                # Phone photos store rotation in EXIF; apply it so the vision
                # model reads the page upright.
                upright = ImageOps.exif_transpose(img)
                rgb = upright.convert("RGB")
                rgb.thumbnail((_IMAGE_MAX_EDGE, _IMAGE_MAX_EDGE))
                buffer = io.BytesIO()
                rgb.save(buffer, "JPEG", quality=88)
        except ValueError:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ValueError(_IMAGE_TOO_LARGE) from exc
        except Exception as exc:
            raise ValueError(_IMAGE_UNREADABLE) from exc
    return base64.b64encode(buffer.getvalue()).decode("ascii")


async def transcribe_image_file(path: str) -> str:
    """Read an uploaded image to text with a vision model.

    One call per configured engine, in the OCR engine order (a failure moves
    on to the next, never re-raised). Raises ValueError when nothing could be
    read, so the upload row shows why.
    """
    from src.services.llm_service import LLMService
    from src.services.ocr_service import _candidate_ocr_engines, _engine_has_key

    image_b64 = await asyncio.to_thread(_image_jpeg_b64, path)
    llm = LLMService()
    calls = {"claude": llm._complete_vision_anthropic, "gemini": llm._complete_vision_gemini}
    for engine in _candidate_ocr_engines(None):
        if not _engine_has_key(engine) or engine not in calls:
            continue
        try:
            text = (await calls[engine](image_b64, "image/jpeg", _IMAGE_TRANSCRIBE_PROMPT)).strip()
        except Exception as exc:
            logger.warning("Image transcription failed (engine=%s): %s", engine, exc)
            continue
        if text:
            return text
    raise ValueError("Nosey couldn't read any text in that image. Try a clearer photo.")
