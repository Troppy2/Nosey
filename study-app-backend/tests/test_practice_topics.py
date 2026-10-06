"""Heading-less practice sheets split by repeated openers and group into
topics (GH #165). The sheet is an excerpt of a real user upload."""
from __future__ import annotations

from unittest.mock import AsyncMock

from src.services.llm_service import LLMService
from src.services.practice_problems import mark_lookalikes, split_problems

SHEET = """Below are several (a lot) of sample quiz problems. They all ask you to write a function similar to the kinds of functions from Homework #1.

Practice writing as many as you need to feel comfortable that you can write these functions.

The questions for quiz #1 will be similar to the ones below.

Write a function named decs that applies a function named dec of type int -> int to each element of an input list containing values of type int. The function dec decrements an integer value by one. You do not need to write dec; you may assume that it exists.

The function decs should have the type int list -> int list.

Write a function named dec_positive that first applies the function dec to all elements of a list and then selects the resulting values that cause the function positive to return true.

The function dec decrements an integer value by one. It has type int -> int. You do not need to write dec; you may assume that it exists.

The function positive has type int -> bool and determines if an integer is positive or not. You do not need to write positive; you may assume that it exists.

The function dec_positive should have type int list -> int list.

Write a function named negate_odd that first applies the function negate to all elements of a list and then selects the resulting values that cause the function odd to return true.

The function negate negates an integer. It has type int -> int. You do not need to write negate; you may assume that it exists.

The function odd has type int -> bool and determines if a number is odd and returns true if it is and false if it is not. You do not need to write odd; you may assume that it exists.

The function negate_odd should have type int list -> int list.

Write a function named negates that applies a function named negate of type int -> int to each element of an input list containing values of type int. The function negate negates an integer. You do not need to write negate; you may assume that it exists.

The function negates should have the type int list -> int list.

Write a function named prod that multiplies all the numbers in a list together. This function combines all the elements in the input list, along with a base value of 1, using a function named mul. This function mul multiplies two numbers together. It has type int -> int -> int. You do not need to write mul; you may assume that it exists. The value 1 is to be returned when the input list is empty.

The function prod should have type int list -> int.

Write a function named odds that selects certain elements out of a list and returns that list of selected elements. The elements to be selected are those that cause the function odd to return true when it is applied to the element. You do not need to write odd; you may assume that it exists.

The function odds should have the type int list -> int list.
"""


def test_repeated_opener_splits_a_sheet_with_no_headings() -> None:
    problems = split_problems(SHEET)
    assert [p.label for p in problems] == ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]
    assert problems[0].title.startswith("Write a function named decs")
    # The "The function X ..." paragraphs stay with the problem above.
    assert "dec_positive should have type" in SHEET[problems[1].start:problems[1].end]
    assert "Below are several" not in SHEET[problems[0].start:problems[0].end]


def test_too_few_repeats_is_not_a_split() -> None:
    text = "Find the area of a circle of radius 2 cm.\n\nExplain why the sky looks blue today.\n"
    assert split_problems(text) == []


def test_lookalikes_point_at_the_first_of_their_pattern() -> None:
    problems = split_problems(SHEET)
    marked = mark_lookalikes(problems, SHEET)
    # decs and negates are the same "map" pattern with different names.
    assert marked[3].similar_to == "Q1"
    assert marked[0].similar_to is None and marked[4].similar_to is None


async def test_topics_reorder_into_named_sections() -> None:
    problems = split_problems(SHEET)
    svc = LLMService()
    svc._complete_json = AsyncMock(return_value={"topics": [  # type: ignore[method-assign]
        {"name": "Map", "problems": ["Q1", "Q4"]},
        {"name": "Map then filter", "problems": ["Q2", "Q3"]},
        {"name": "Fold", "problems": ["Q5"]},
    ]})
    grouped = await svc.group_practice_topics(problems, SHEET)
    assert [(p.label, p.chapter) for p in grouped] == [
        ("Q1", "Map"), ("Q4", "Map"), ("Q2", "Map then filter"), ("Q3", "Map then filter"),
        ("Q5", "Fold"), ("Q6", "Other"),
    ]
    assert grouped[1].similar_to == "Q1"


async def test_topic_call_failure_keeps_the_flat_list() -> None:
    problems = split_problems(SHEET)
    svc = LLMService()
    svc._complete_json = AsyncMock(side_effect=RuntimeError("down"))  # type: ignore[method-assign]
    assert await svc.group_practice_topics(problems, SHEET) == problems
