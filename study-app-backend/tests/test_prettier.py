"""Editor Prettier pass: layout changes only, words kept, nothing saved."""
from __future__ import annotations

from unittest.mock import AsyncMock

from src.services.llm_service import LLMService, prettier_words_preserved

RAW = "Write a function safe_div that takes a and b. Input Format: two ints Output Format: int option Example 1: safe_div 10 2 returns Some 5"
PRETTY = (
    "Write a function `safe_div` that takes `a` and `b`.\n\n**Input:** two ints\n\n**Output:** int option\n\n"
    "**Example 1**\n\n```\nsafe_div 10 2\n```\n\nReturns `Some 5`"
)


def test_layout_change_keeps_the_words() -> None:
    assert prettier_words_preserved(RAW, PRETTY)
    assert prettier_words_preserved("Find x^2 + 1 = 5", "Find $x^{2} + 1 = 5$")
    assert prettier_words_preserved("Compute the integral of x from 0 to 1", "Compute $\\int_0^1 x\\,dx$") is False


def test_restructuring_a_real_quiz_card_is_allowed() -> None:
    old = (
        "Write a function named first_letters that applies a function named first_letter of type string -> char "
        "to each element of an input list containing values of type string. The function first_letter returns the "
        "first character in a string and the character '!' if the string is empty.. You do not need to write "
        "first_letter; you may assume that it exists. The function first_letters should produce a list of values "
        "of type char resulting from the application of first_letter.\n\n"
        "The function first_letters should have the type string list -> char list."
    )
    new = (
        "Write a function named `first_letters` that applies a function named `first_letter` of type "
        "`string -> char` to each element of an input list containing values of type `string`.\n\n"
        "`first_letter` returns the first character in a string, and the character `'!'` if the string is empty. "
        "You do not need to write `first_letter`; you may assume that it exists.\n\n"
        "**Input:** a list of values of type `string`\n\n"
        "**Output:** a list of values of type `char` resulting from the application of `first_letter`\n\n"
        "**Type:** `first_letters : string list -> char list`"
    )
    assert prettier_words_preserved(old, new)
    # Swapping a type is a content change, not formatting.
    assert not prettier_words_preserved(old, new.replace("char list", "string list").replace("`char`", "`int`"))


def test_reworded_or_changed_numbers_are_rejected() -> None:
    assert not prettier_words_preserved(RAW, PRETTY.replace("10 2", "12 3").replace("Some 5", "Some 4"))
    assert not prettier_words_preserved("Find the mean of 2, 4, 6.", "Calculate the average value of the numbers given below, which are 2, 4 and 6, and explain.")


def _svc(reply: dict) -> LLMService:
    svc = LLMService()
    svc._complete_json = AsyncMock(return_value=reply)  # type: ignore[method-assign]
    return svc


async def test_only_changed_and_faithful_questions_come_back() -> None:
    questions = [
        {"id": 1, "type": "FRQ", "question_text": RAW, "options": None, "expected_answer": "let safe_div a b = if b = 0 then None else Some (a / b)"},
        {"id": 2, "type": "FRQ", "question_text": "Already fine.", "options": None, "expected_answer": "x"},
        {"id": 3, "type": "MCQ", "question_text": "What is 2+2?", "options": ["3", "4"], "expected_answer": None},
    ]
    svc = _svc({"questions": [
        {"id": 1, "question_text": PRETTY, "options": None,
         "expected_answer": "```ocaml\nlet safe_div a b = if b = 0 then None else Some (a / b)\n```"},
        {"id": 2, "question_text": "Already fine.", "options": None, "expected_answer": "x"},
        {"id": 3, "question_text": "Which planet is largest?", "options": ["3", "4"], "expected_answer": None},
        {"id": 99, "question_text": "invented"},
    ]})
    out = await svc.prettify_questions(questions, "coding", "OCaml")
    assert set(out) == {1}
    assert out[1]["question_text"] == PRETTY and out[1]["expected_answer"].startswith("```ocaml")
    prompt = svc._complete_json.await_args.args[0]
    assert "**Input:**" in prompt and "FORMAT ONLY" in prompt


async def test_a_failed_batch_returns_nothing() -> None:
    svc = LLMService()
    svc._complete_json = AsyncMock(side_effect=RuntimeError("down"))  # type: ignore[method-assign]
    out = await svc.prettify_questions(
        [{"id": 1, "type": "FRQ", "question_text": RAW, "options": None, "expected_answer": "x"}], "coding"
    )
    assert out == {}
