"""Section detection for the practice-test chapter picker (GH #133)."""
from __future__ import annotations

from src.services.practice_sections import detect_sections, slice_sections

EXAM = """Midterm Exam 2
Name: ____________

PART I. MULTIPLE CHOICE (4 points each)
1. What is the molarity of 0.50 mol in 250 mL?
A. 0.125 M
B. 2.0 M
2. Which is a strong acid?
A. HF
B. HNO3

PART II. TRUE / FALSE
3. Ionic bonds share electrons equally. (True / False)
4. Catalysts are consumed. (True / False)

ANSWER KEY
1. B
2. B
3. False
4. False
"""

HOMEWORK = """# CSCI 2033 HW

Contents
Chapter 1 - Vectors 7
1.1 Vector equations . . . . . . . . . . . 7
Chapter 2 - Linear functions 28
2.1 Linear or not? . . . . . . . . . . . . 28

## Chapter 1 - Vectors
1.1 Vector equations
Determine whether (1, 2) = (1, 2).
1.2 Vector notation
Which expressions use correct notation?

## Chapter 2 - Linear functions
2.1 Linear or not?
Is f(x) = max(x) - min(x) linear?
"""


def test_parts_are_found_and_the_answer_key_is_not_counted() -> None:
    sections = detect_sections(EXAM)
    assert [(s.title, s.question_count) for s in sections] == [
        ("PART I. MULTIPLE CHOICE (4 points each)", 2),
        ("PART II. TRUE / FALSE", 2),
    ]


def test_table_of_contents_chapters_are_skipped() -> None:
    sections = detect_sections(HOMEWORK)
    assert [(s.title, s.question_count) for s in sections] == [
        ("Chapter 1 - Vectors", 2),
        ("Chapter 2 - Linear functions", 1),
    ]


def test_slice_keeps_the_chosen_sections_and_the_answer_key() -> None:
    sliced = slice_sections(EXAM, [1])
    assert "Ionic bonds" in sliced
    assert "molarity" not in sliced
    assert "ANSWER KEY" in sliced and "3. False" in sliced


def test_unknown_indices_fall_back_to_the_whole_document() -> None:
    assert slice_sections(EXAM, [7]) == EXAM


def test_one_section_means_no_picker() -> None:
    assert detect_sections("PART I\n1. Only question here?\n") == []
