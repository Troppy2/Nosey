"""GH #171: uploads must be refused or scaled BEFORE decoding to full size.

A tiny PNG can declare 40000x40000 px (6 GB decoded). The checks here must
reject it from the header alone, without ever handing it to the decoder.
"""

import base64
import struct
import zlib

import pytest

from src.services import practice_vision as pv

fitz = pytest.importorskip("fitz")


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _bomb_png(width: int, height: int) -> bytes:
    """A valid PNG header declaring width x height, with a tiny (truncated) body."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00" * 64)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def test_bomb_png_is_refused_without_decoding(tmp_path, monkeypatch):
    path = tmp_path / "bomb.png"
    path.write_bytes(_bomb_png(40000, 40000))
    assert path.stat().st_size < 1000

    def _never(*_args, **_kwargs):
        raise AssertionError("fitz.Pixmap must not be called on an oversized image")

    monkeypatch.setattr(pv.fitz, "Pixmap", _never)
    with pytest.raises(ValueError, match="too large"):
        pv._image_jpeg_b64(str(path))


def test_image_just_over_the_cap_is_refused(tmp_path):
    path = tmp_path / "big.png"
    path.write_bytes(_bomb_png(8000, 5001))  # 40,008,000 px
    with pytest.raises(ValueError, match="too large"):
        pv._image_jpeg_b64(str(path))


def test_non_image_with_image_extension_is_refused(tmp_path):
    path = tmp_path / "fake.png"
    path.write_bytes(b"%PDF-1.4 not an image")
    with pytest.raises(ValueError, match="could not be opened"):
        pv._image_jpeg_b64(str(path))


def test_normal_photo_still_reads(tmp_path):
    from PIL import Image

    path = tmp_path / "photo.jpg"
    Image.new("RGB", (3000, 4000), (200, 210, 220)).save(path, "JPEG")
    encoded = pv._image_jpeg_b64(str(path))
    out = Image.open(__import__("io").BytesIO(base64.b64decode(encoded)))
    assert max(out.size) <= pv._IMAGE_MAX_EDGE


def test_giant_pdf_page_renders_under_the_pixel_cap(tmp_path):
    path = tmp_path / "giant.pdf"
    doc = fitz.open()
    doc.new_page(width=14400, height=14400)
    doc.new_page(width=612, height=792)  # US letter
    doc.save(path)
    doc.close()

    images = pv._render_pages(str(path), [0, 1])
    giant = fitz.Pixmap(base64.b64decode(images[0]))
    assert giant.width * giant.height <= pv._RENDER_MAX_PIXELS
    normal = fitz.Pixmap(base64.b64decode(images[1]))
    # Letter at the usual 2x zoom: 612x792 pt -> 1224x1584 px, unchanged.
    assert (normal.width, normal.height) == (1224, 1584)
