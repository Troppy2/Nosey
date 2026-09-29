"""Long exam-style custom instructions: notebook uploads, bigger source window,
exercise/chapter retrieval bias, and student instructions overriding mode rules."""
from __future__ import annotations

import json

import pytest

from src.services.file_service import FileService
from src.services.llm_service import (
    _GENERATE_CHAR_LIMIT,
    _GENERATE_CHAR_LIMIT_LONG,
    _RETRIEVAL_TOP_K,
    _RETRIEVAL_TOP_K_LONG,
    LLMService,
)
from src.services.rag_service import HybridRAGService, RagChunk
from src.utils.exceptions import ValidationException
from src.utils.validators import ALLOWED_FILE_TYPES


def _notebook(cells: list[dict]) -> bytes:
    return json.dumps(
        {"cells": cells, "metadata": {"language_info": {"name": "python"}}, "nbformat": 4}
    ).encode("utf-8")


def test_ipynb_is_an_allowed_upload_type() -> None:
    assert "ipynb" in ALLOWED_FILE_TYPES


def test_notebook_keeps_markdown_and_fenced_code_and_drops_outputs() -> None:
    data = _notebook([
        {"cell_type": "markdown", "source": ["# Lab 3\n", "k-Nearest Neighbors"]},
        {
            "cell_type": "code",
            "source": ["def kNN_predict(test_vec, k):\n", "    return 0"],
            "outputs": [{"output_type": "stream", "text": ["SECRET_OUTPUT"]}],
        },
        {"cell_type": "code", "source": []},
    ])
    text = FileService()._parse_bytes(data, "ipynb")
    assert "Lab 3" in text
    assert "```python" in text
    assert "def kNN_predict(test_vec, k):" in text
    assert "SECRET_OUTPUT" not in text


def test_invalid_notebook_raises_validation_error() -> None:
    with pytest.raises(ValidationException):
        FileService()._parse_bytes(b"not json", "ipynb")


def test_context_budget_scales_only_for_long_instructions() -> None:
    assert LLMService._context_budget(None) == (_GENERATE_CHAR_LIMIT, _RETRIEVAL_TOP_K)
    assert LLMService._context_budget("short") == (_GENERATE_CHAR_LIMIT, _RETRIEVAL_TOP_K)
    assert LLMService._context_budget("x" * 1500) == (_GENERATE_CHAR_LIMIT_LONG, _RETRIEVAL_TOP_K_LONG)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("covering material from Chapters 1 through 4", {1, 2, 3, 4}),
        ("ch 2-3 only", {2, 3}),
        ("Chapters 1, 2 and 5", {1, 2, 5}),
        ("no scope here", None),
        (None, None),
    ],
)
def test_chapter_scope_parsing(text: str | None, expected: set[int] | None) -> None:
    result = LLMService._chapter_scope(text)
    assert (set(result) if result else None) == expected


def _chunk(index: int, section: str) -> RagChunk:
    return RagChunk(index=index, source="HW.md", text=f"chunk {index}", tokens=(), section=section)


def test_exam_bias_boosts_exercises_and_demotes_out_of_scope_chapters() -> None:
    ranked = [
        _chunk(0, "HW > Chapter 14 - Least squares classification"),
        _chunk(1, "HW Guide (Chapters 1-4) > Chapter 1 - Vectors > Definitions"),
        _chunk(2, "HW Guide (Chapters 1-4) > Chapter 1 - Vectors > 1.20 Storage and flops"),
    ]
    order = HybridRAGService._apply_exam_bias(ranked, True, frozenset({1, 2, 3, 4}))
    # Exercise (0.33 * 1.5) passes the out-of-scope chapter (1.0 * 0.4); the
    # top-ranked in-scope chunk keeps first place.
    assert [chunk.index for chunk in order] == [1, 2, 0]


def test_exam_bias_keeps_every_chunk() -> None:
    ranked = [_chunk(i, "Chapter 9") for i in range(5)]
    order = HybridRAGService._apply_exam_bias(ranked, False, frozenset({1}))
    assert [chunk.index for chunk in order] == [0, 1, 2, 3, 4]


def test_student_instructions_come_after_math_rules() -> None:
    prompt = LLMService()._build_math_generation_prompt(
        "notes", 2, 1, "mixed", custom_instructions="Include one proof question."
    )
    assert prompt.index("CONTENT RULES") < prompt.index("STUDENT INSTRUCTIONS")
    assert prompt.index("STUDENT INSTRUCTIONS") < prompt.index("Return JSON only")
    assert "Include one proof question." in prompt


def test_long_instructions_widen_the_math_source_slice() -> None:
    notes = "a" * 30_000
    short = LLMService()._build_math_generation_prompt(notes, 1, 0, "mixed", custom_instructions="x")
    long = LLMService()._build_math_generation_prompt(notes, 1, 0, "mixed", custom_instructions="x" * 1500)
    assert short.count("a") < 10_000
    assert long.count("a") >= 30_000
