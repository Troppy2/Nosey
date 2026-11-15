"""Handwritten matrices keep their rows (2026-11-15).

The OCR cleanup stripped "\\ " row breaks as if they were control spaces, so a
3x3 matrix rendered as one row and the grader blamed the student for it.
Backslashes are built with chr(92) so no editor or tool can unescape them.
"""
from __future__ import annotations

from src.services.ocr_service import normalize_transcript
from src.utils.latex_utils import repair_matrix_rows

BS = chr(92)
ROW = BS + BS


def _matrix(*rows: str) -> str:
    return BS + "begin{bmatrix} " + f" {ROW} ".join(rows) + " " + BS + "end{bmatrix}"


def test_row_breaks_before_digits_fractions_and_letters_survive() -> None:
    frac = BS + "frac{X_1+X_7}{2}"
    for line in (
        "$A = " + _matrix("4 & 2 & 4", "5 & 2 & 5", "6 & 2 & 6") + "$",
        "$" + _matrix("X_4", "X_5", frac, "1/2") + "$",
    ):
        out = normalize_transcript(line)
        assert out.count(ROW) == line.count(ROW), out


def test_a_matrix_stays_display_math_on_its_own_line() -> None:
    out = normalize_transcript("So" + chr(10) + "$$" + _matrix("1 & 2", "3 & 4") + "$$")
    assert out.split(chr(10) + chr(10))[-1] == "$$" + _matrix("1 & 2", "3 & 4") + "$$"


def test_a_line_that_is_one_inline_matrix_becomes_display() -> None:
    out = normalize_transcript("$" + _matrix("1", "2") + "$")
    assert out == "$$" + _matrix("1", "2") + "$$"


def test_single_line_display_math_still_goes_inline() -> None:
    assert normalize_transcript("$$x = 4$$") == "$x = 4$"


def test_spacing_commands_are_still_stripped() -> None:
    out = normalize_transcript("$a " + BS + "quad b " + BS + ", c$")
    assert BS + "quad" not in out and BS + "," not in out


def test_repair_restores_a_lost_row_break_only_inside_a_matrix() -> None:
    broken = BS + "begin{bmatrix} 4 & 2 " + BS + " 5 & 2 " + BS + "end{bmatrix}"
    assert repair_matrix_rows(broken) == _matrix("4 & 2", "5 & 2")
    # A correct matrix and a control space outside any matrix are untouched.
    good = _matrix("1 & 2", "3 & 4")
    assert repair_matrix_rows(good) == good
    prose = "$a" + BS + " b$"
    assert repair_matrix_rows(prose) == prose
