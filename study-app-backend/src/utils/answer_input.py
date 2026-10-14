"""Per-question answer input (Custom mode).

A test has one mode: general, STEM (math keyboard) or coding. A Custom-mode
test instead sets an input on each question, so one test can ask for typed
text in one part and a math answer or code in another.

questions.answer_input is NULL for every question made before Custom mode
and for every question Nosey generates. NULL means "use the test's mode", so
question_modes() gives exactly the old test-level flags for those questions
and existing tests grade the same as before.
"""
from __future__ import annotations

from typing import Any, Optional

# "choice" is for objective types (MCQ/TF/MS/RANK), which ignore the flags.
ANSWER_INPUTS = ("choice", "text", "math", "code")
OBJECTIVE_TYPES = ("MCQ", "TF", "MS", "RANK")


def question_modes(question: Any, test: Any) -> tuple[bool, bool, str]:
    """(is_math, is_coding, coding_language) to grade one question with."""
    test_language = getattr(test, "coding_language", None) or "Python"
    answer_input: Optional[str] = getattr(question, "answer_input", None)
    if not answer_input:
        return (
            bool(getattr(test, "is_math_mode", False)),
            bool(getattr(test, "is_coding_mode", False)),
            test_language,
        )
    if answer_input == "math":
        return True, False, test_language
    if answer_input == "code":
        return False, True, getattr(question, "code_language", None) or test_language
    return False, False, test_language


def is_custom_mode(questions: Any) -> bool:
    """A test is Custom mode when any of its questions sets its own input."""
    return any(getattr(q, "answer_input", None) for q in questions)
