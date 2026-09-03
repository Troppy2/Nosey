"""Phase 1 verification for the STEM Scratch Pad OCR seam.

Throwaway script, not part of the app. Generates a synthetic "handwriting-like"
PNG (real stylus testing is Phase 5, on a real tablet), runs it through
OcrService, and checks the invariants that matter before any frontend work:
  1. A real transcription round-trip works end to end.
  2. No base64 image data appears in DEBUG logs.
  3. A bad API key fails cleanly without dumping the payload.

Run: PYTHONPATH=. ../.venv/Scripts/python.exe scripts/verify_ocr_seam.py
(from study-app-backend/, with asyncio.WindowsSelectorEventLoopPolicy per repo convention)
"""
import asyncio
import base64
import io
import logging
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from PIL import Image, ImageDraw, ImageFont


def make_synthetic_work_png() -> str:
    img = Image.new("RGB", (600, 300), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("comic.ttf", 28)
    except Exception:
        font = ImageFont.load_default()
    lines = [
        "2x + 3 = 11",
        "2x = 8",
        "x = 4",
    ]
    y = 30
    for line in lines:
        draw.text((30, y), line, fill="black", font=font)
        y += 60
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


async def main() -> None:
    # Capture logs at DEBUG so we can grep for a base64 leak.
    log_buffer = io.StringIO()
    handler = logging.StreamHandler(log_buffer)
    handler.setLevel(logging.DEBUG)
    logging.getLogger("src").setLevel(logging.DEBUG)
    logging.getLogger("src").addHandler(handler)

    from src.services.ocr_service import OcrService

    image_b64 = make_synthetic_work_png()
    print(f"Generated synthetic work image: {len(image_b64)} base64 chars")

    result = await OcrService().transcribe(image_b64, engine="claude")
    print("\n--- OcrResult ---")
    if result is None:
        print("FAILED: transcribe() returned None (check ANTHROPIC_API_KEY / network)")
    else:
        print(f"engine: {result.engine}")
        print(f"confidence: {result.confidence}")
        print(f"transcript: {result.transcript!r}")
        print(f"layout_notes: {result.layout_notes!r}")

    logs = log_buffer.getvalue()
    print("\n--- Log leak check ---")
    # A real base64 PNG string is long and has no spaces; a leak would show up
    # as a large contiguous chunk of the actual image data in the log text.
    if image_b64[:200] in logs:
        print("FAIL: image base64 data appears in logs!")
    else:
        print("PASS: no image base64 data found in captured logs")
    print(f"(captured {len(logs)} chars of log output at DEBUG level)")

    print("\n--- Bad-key failure check ---")
    from src.config import settings

    real_key = settings.anthropic_api_key
    settings.anthropic_api_key = "sk-ant-invalid-test-key"
    try:
        bad_result = await OcrService().transcribe(image_b64, engine="claude")
        if bad_result is None:
            print("PASS: bad key -> transcribe() returned None cleanly (no raise, no payload dump)")
        else:
            print(f"UNEXPECTED: bad key still produced a result: {bad_result}")
    finally:
        settings.anthropic_api_key = real_key

    logs_after = log_buffer.getvalue()
    if image_b64[:200] in logs_after:
        print("FAIL: image base64 data appears in logs after the bad-key attempt!")
    else:
        print("PASS: no image base64 data found in logs after the bad-key attempt")


if __name__ == "__main__":
    asyncio.run(main())
