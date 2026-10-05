"""Problem splitting for the practice-test picker and the #138 parse fixes."""
from __future__ import annotations

import pytest

from src.routes.tests import _reviewed_questions_from_form
from src.services.llm_service import (
    GeneratedFRQ,
    GeneratedMCQ,
    _drop_mcq_twins,
    _is_near_duplicate,
    _practice_norm,
)
from src.services.practice_problems import clean_title, problem_text, split_problems
from src.services.practice_sections import detect_sections
from src.utils.exceptions import StudyAppException

WORKSHEET = """## CSCI 2033 Practice Worksheet

### Contents

Chapter 1: Vectors 4

1.1 Vector equations . . . . . . . . . . . . . . 5

1.2 Vector notation . . . . . . . . . . . . . . . 6

# Chapter 1

### 1.1 Vector equations

Determine whether each equation is true or false.

(a)

(b) (1, (2, 1)) = ((1, 2), 1).

CSCI 2033 Practice 5
### 1.2 Vector notation PRI
ORITY

Which expressions use correct notation?

(a) a + b.

CSCI 2033 Practice 6
# Chapter 2

### C2.A Deviation of middle element SEEN IN HW

Suppose x is an n-vector.

### C2.B Questionnaire scoring

A questionnaire has 10 questions.

CSCI 2033 Practice 7
"""

EXAM = """Midterm 2

1. What is the molarity of 0.50 mol in 250 mL?
A. 0.125 M
B. 2.0 M
2. Which is a strong acid?
Steps:
1. Look at the list
3. Ionic bonds share electrons equally.

ANSWER KEY
1. B
2. B
3. False
"""


def test_split_finds_heading_problems_with_chapters_and_parts() -> None:
    problems = split_problems(WORKSHEET)

    assert [(p.label, p.title, p.chapter, p.part_count) for p in problems] == [
        ("1.1", "Vector equations", "Chapter 1", 2),
        ("1.2", "Vector notation", "Chapter 1", 1),
        ("C2.A", "Deviation of middle element", "Chapter 2", 0),
        ("C2.B", "Questionnaire scoring", "Chapter 2", 0),
    ]
    assert problems[1].preview.startswith("Which expressions")


def test_problem_text_drops_footers_and_labels() -> None:
    p = split_problems(WORKSHEET)[1]
    text = problem_text(WORKSHEET, p.start, p.end)

    assert text.startswith("### 1.2 Vector notation\n")
    assert "ORITY" not in text and "CSCI 2033 Practice" not in text
    assert "Chapter 2" not in text


def test_split_numbered_exam_keeps_an_ascending_run_and_skips_the_key() -> None:
    problems = split_problems(EXAM)

    assert [p.label for p in problems] == ["1", "2", "3"]
    assert "ANSWER KEY" not in EXAM[problems[-1].start:problems[-1].end]


def test_split_without_headings_is_empty() -> None:
    assert split_problems("Some notes about plants.\n\nMore notes.") == []


def test_clean_title_keeps_an_all_caps_title() -> None:
    assert clean_title("Interpreting sparsity SEEN IN HW") == "Interpreting sparsity"
    assert clean_title("TRUE OR FALSE") == "TRUE OR FALSE"


def test_section_detector_counts_markdown_heading_problems() -> None:
    # Before GH #138 every "### 1.1" heading counted 0 and the picker never showed.
    text = WORKSHEET.replace("C2.A", "2.1").replace("C2.B", "2.2")
    sections = detect_sections(text)

    assert [(s.title, s.question_count) for s in sections] == [("Chapter 1", 2), ("Chapter 2", 2)]


def test_near_duplicate_catches_reworded_overlap_copies() -> None:
    kept = [_practice_norm("Suppose the vectors x1, ..., xN are clustered using k-means. Explain why z is nonnegative.")]

    assert _is_near_duplicate("Suppose the vectors x1,...,xN are clustered using k means. Explain why z is nonnegative", kept)
    assert not _is_near_duplicate("What is the molarity of 0.5 mol in 250 mL?", kept)
    assert not _is_near_duplicate("Compute 3 + 5 using the rule above.", [_practice_norm("Compute 3 + 4 using the rule above.")])


def test_mcq_twin_of_a_written_question_is_dropped() -> None:
    frq = [GeneratedFRQ("If beta_2 = 0, does y depend on x_2?", "No")]
    mcq = [GeneratedMCQ("If beta_2 = 0, does y depend on x_2?", ["Yes", "No"], 1)]

    assert _drop_mcq_twins(mcq, frq) == []


def test_reviewed_questions_from_form() -> None:
    raw = (
        '[{"kind": "mcq", "question_text": "Q1", "options": ["a", "b"], "correct_index": 1},'
        ' {"kind": "frq", "question_text": "Q2", "expected_answer": "", "answer_inferred": false}]'
    )
    mcq, frq = _reviewed_questions_from_form(raw)

    assert mcq[0].correct_index == 1
    assert frq[0].answer_inferred is True  # no answer given: Nosey works it out
    assert _reviewed_questions_from_form(None) is None
    with pytest.raises(StudyAppException):
        _reviewed_questions_from_form('[{"kind": "mcq", "question_text": "Q", "options": ["a"], "correct_index": 0}]')
