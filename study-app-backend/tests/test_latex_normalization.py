r"""Tests for src/utils/latex_utils.normalize_latex.

normalize_latex is the last transform applied to model output before it is
stored or returned, so anything it breaks here is unrecoverable downstream.

The bug these tests were written for: a lesson containing a column vector
rendered as a stray "c =" box, then the literal text "1 \\ 2 \\ 3", then a red
KaTeX error block holding two paragraphs of prose. The cause was the
\begin{env}...\end{env} rule, which deleted the environment and replaced it
with $$...$$, leaving an odd number of display delimiters behind.

Every string below is a raw string, so a backslash in the source is a backslash
in the data. LaTeX row separators are therefore written \\ exactly as a model
would emit them.
"""
from __future__ import annotations

import re

import pytest

from src.utils.latex_utils import normalize_latex


def display_delimiter_count(text: str) -> int:
    return text.count("$$")


def display_blocks(text: str) -> list[str]:
    return re.findall(r"\$\$(.*?)\$\$", text, flags=re.S)


# ── The reported failure ─────────────────────────────────────────────────────

VECTOR_LESSON = r"""The coefficient vector is:

$$\mathbf{c} = \begin{bmatrix} 1 \\ 2 \\ 3 \end{bmatrix}$$

(constant term first). This vector *encodes* the polynomial completely.

## Computing the Derivative

The derivative $f'(x) = 6x + 2$ has coefficients $[2, 6]$. You can derive this
using a **differentiation matrix** $D$:

$$D = \begin{bmatrix} 0 & 1 & 0 \\ 0 & 0 & 2 \end{bmatrix}$$
"""


def test_matrix_environment_inside_display_math_is_left_intact():
    out = normalize_latex(VECTOR_LESSON)
    assert r"\begin{bmatrix}" in out
    assert r"\end{bmatrix}" in out
    assert r"$$\mathbf{c} = \begin{bmatrix} 1 \\ 2 \\ 3 \end{bmatrix}$$" in out


def test_matrix_lesson_keeps_its_delimiters_balanced():
    out = normalize_latex(VECTOR_LESSON)
    assert display_delimiter_count(out) % 2 == 0, f"odd number of $$ in:\n{out}"


def test_matrix_lesson_does_not_swallow_prose_into_math():
    # The visible symptom: the prose after the first matrix ended up inside a
    # display-math block, which KaTeX rendered as a red error.
    out = normalize_latex(VECTOR_LESSON)
    assert "(constant term first). This vector *encodes* the polynomial completely." in out
    assert "\n## Computing the Derivative\n" in out
    for block in display_blocks(out):
        assert "\n\n" not in block, f"prose paragraph captured as math: {block!r}"
        assert not re.search(r"^#{1,6} ", block, flags=re.M), f"heading captured as math: {block!r}"


def test_normalize_latex_is_a_no_op_on_the_vector_lesson():
    # Nothing in this article needs normalizing, so it must come back untouched.
    assert normalize_latex(VECTOR_LESSON) == VECTOR_LESSON


def test_no_triple_dollar_runs_are_produced():
    assert "$$$" not in normalize_latex(VECTOR_LESSON)


# ── Other environments ───────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "env",
    ["bmatrix", "pmatrix", "vmatrix", "matrix", "cases", "aligned", "array", "align*"],
)
def test_environments_inside_display_math_survive(env):
    src = r"$$\begin{%s} a & b \\ c & d \end{%s}$$" % (env, env)
    assert normalize_latex(src) == src


def test_environment_inside_inline_math_survives():
    src = r"The system $\begin{cases} x = 1 \\ y = 2 \end{cases}$ holds."
    assert normalize_latex(src) == src


def test_bare_environment_outside_math_is_wrapped_not_stripped():
    src = "Here it is:\n" + r"\begin{bmatrix} 1 \\ 2 \end{bmatrix}" + "\nand that is all."
    out = normalize_latex(src)
    assert r"\begin{bmatrix}" in out
    assert r"\end{bmatrix}" in out
    assert r"$$\begin{bmatrix} 1 \\ 2 \end{bmatrix}$$" in out


def test_multiline_bare_environment_is_wrapped_whole():
    src = "Given:\n" + r"\begin{aligned}" + "\nx &= 1 " + r"\\" + "\ny &= 2\n" + r"\end{aligned}" + "\nDone."
    out = normalize_latex(src)
    assert out.count("$$") == 2
    assert r"\begin{aligned}" in out and r"\end{aligned}" in out


# ── Bracket delimiters ───────────────────────────────────────────────────────

def test_bracket_display_math_becomes_double_dollar():
    assert normalize_latex(r"\[x^2 + y^2\]") == "$$x^2 + y^2$$"


def test_bracket_inline_math_becomes_single_dollar():
    assert normalize_latex(r"value \(x^2\) here") == "value $x^2$ here"


def test_bracket_display_math_containing_a_matrix_keeps_the_matrix():
    out = normalize_latex(r"\[\begin{bmatrix} 1 \\ 2 \end{bmatrix}\]")
    assert out == r"$$\begin{bmatrix} 1 \\ 2 \end{bmatrix}$$"


def test_bracket_delimiters_inside_existing_display_math_are_not_reprocessed():
    src = r"$$\left[ \frac{a}{b} \right]$$"
    assert normalize_latex(src) == src


# ── Code must never be treated as math ───────────────────────────────────────

def test_fenced_code_block_is_untouched():
    src = (
        "Example:\n"
        "```latex\n"
        + r"\begin{bmatrix} 1 \\ 2 \end{bmatrix}" + "\n"
        + r"\frac{a}{b}" + "\n"
        "```\n"
        "Done.\n"
    )
    assert normalize_latex(src) == src


def test_shell_code_block_with_dollar_variables_is_untouched():
    src = "```bash\necho $HOME and $USER\n```\n"
    assert normalize_latex(src) == src


def test_inline_code_span_is_untouched():
    src = r"Call `\frac{a}{b}` to format it."
    assert normalize_latex(src) == src


def test_code_fence_does_not_leak_into_following_prose():
    src = "```python\nx = 1\n```\n" + r"Then \theta is the angle."
    out = normalize_latex(src)
    assert "```python\nx = 1\n```\n" in out
    assert r"$\theta$" in out


# ── Existing behaviour that must keep working ────────────────────────────────

def test_bare_latex_command_in_prose_is_wrapped():
    out = normalize_latex(r"The derivative is \frac{dy}{dx} today.")
    assert r"$\frac{dy}{dx}$" in out


def test_bare_greek_letter_in_prose_is_wrapped():
    out = normalize_latex(r"Let \theta be the angle.")
    assert r"$\theta$" in out


def test_existing_inline_math_is_not_double_wrapped():
    src = r"The derivative is $\frac{dy}{dx}$ today."
    assert normalize_latex(src) == src


def test_existing_display_math_is_not_double_wrapped():
    src = r"$$\frac{dy}{dx} = 3t^{2} + 1$$"
    assert normalize_latex(src) == src


def test_plain_markdown_is_unchanged():
    src = (
        "# Title\n\n"
        "Some **bold** and *italic* prose.\n\n"
        "- item one\n"
        "- item two\n\n"
        "| a | b |\n| - | - |\n| 1 | 2 |\n"
    )
    assert normalize_latex(src) == src


def test_empty_input_is_passed_through():
    assert normalize_latex("") == ""


def test_heading_and_list_items_with_math_are_preserved():
    src = "## The $\\theta$ section\n\n- first $x^2$\n- second $y^2$\n"
    assert normalize_latex(src) == src


def test_multiple_display_blocks_on_one_line_stay_separate():
    src = r"$$a$$ and $$b$$"
    assert normalize_latex(src) == src


@pytest.mark.parametrize(
    "src",
    [
        VECTOR_LESSON,
        r"\[\begin{bmatrix} 1 \\ 2 \end{bmatrix}\]",
        r"The derivative is \frac{dy}{dx} today.",
        r"Let \theta be the angle and \alpha the other.",
        "```latex\n" + r"\frac{a}{b}" + "\n```\n",
        r"Mix $x^2$ and \(y^2\) and \[z^2\] in one line.",
        "Here it is:\n" + r"\begin{bmatrix} 1 \\ 2 \end{bmatrix}" + "\nand that is all.",
    ],
)
def test_normalize_latex_is_idempotent(src):
    once = normalize_latex(src)
    assert normalize_latex(once) == once
