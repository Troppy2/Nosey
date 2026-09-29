from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_importing_file_service_does_not_load_onnxruntime() -> None:
    """pymupdf4llm >= 1.27.2.1 hard-requires pymupdf-layout, which activates an
    onnxruntime layout model on import (~74 MB resident, more per parse). That is
    what the Render 512 MB box could not afford, so the PDF stack stays pre-layout.

    Runs in a subprocess because other tests may already have imported modules.
    """
    probe = (
        "import sys; import src.services.file_service; "
        "print('LOADED=' + ','.join(m for m in ('onnxruntime', 'pymupdf.layout') if m in sys.modules))"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    # PyMuPDF prints its own notices to stdout, so read only the marker line.
    marker = next(line for line in result.stdout.splitlines() if line.startswith("LOADED="))
    assert marker == "LOADED="
