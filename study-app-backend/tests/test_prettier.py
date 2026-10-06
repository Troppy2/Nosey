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


DECS = (
    "Write a function named decs that applies a function named dec of type int -> int to each element of an input "
    "list containing values of type int. The function dec decrements an integer value by one. You do not need to "
    "write dec; you may assume that it exists. The function decs should produce a list of values of type int "
    "resulting from the application of dec.\n\nThe function decs should have the type int list -> int list."
)
DECS_CLEAR = (
    "**Problem**\n"
    "Write `decs`, which applies `dec` (of type `int -> int`) to every element of a list. `dec` decrements an "
    "integer by one and already exists.\n\n"
    "**Inputs**\n- `lst` : `int list` - the numbers\n\n"
    "**Outputs**\n- `int list` - each element after `dec`"
)
DECS_EXAMPLE = (
    DECS_CLEAR + "\n\n**Examples**\n\n1. `decs [3; 0; -2]`\n   => `[2; -1; -3]`\n\n2. `decs []`\n   => `[]`"
)
UPPERS = (
    "Write a function named uppers that applies a function named uppercase of type string -> string to each "
    "element of an input list containing values of type string. The function uppercase converts all letters in a "
    "string to upper case letters. You do not need to write uppercase; you may assume that it exists. The function "
    "uppers should produce a list of values of type string resulting from the application of uppercase.\n\n"
    "The function uppers should have the type string list -> string list."
)
UPPERS_GOAL = (
    "**Problem**\nWrite a function named `uppers` that applies a function named `uppercase` (of type "
    "`string -> string`) to each element of an input list of strings. The function `uppercase` converts all "
    "letters in a string to upper case letters. You do not need to write `uppercase`; assume it exists.\n\n"
    "**Inputs**\n- `lst` : `string list` - a list of strings\n\n"
    "**Outputs**\n- `string list` - each element after `uppercase`\n\n"
    "**Examples**\n\n1. `uppers [\"hello\", \"World\", \"abc\"]`\n   => `[\"HELLO\", \"WORLD\", \"ABC\"]`\n\n"
    "2. `uppers []`\n   => `[]`\n\n3. `uppers [\"\", \"a\", \"Hello There\"]`\n   => `[\"\", \"A\", \"HELLO THERE\"]`"
)


def test_clarity_rewrite_keeps_the_facts() -> None:
    from src.services.llm_service import prettier_keeps_facts
    # The user's own target layout passes in coding mode.
    assert prettier_keeps_facts(UPPERS, UPPERS_GOAL, allow_example=True)
    assert prettier_keeps_facts(DECS, DECS_EXAMPLE, allow_example=True)
    # Outside coding mode new values (examples) and new names are not allowed.
    assert not prettier_keeps_facts(DECS, DECS_EXAMPLE)
    # Facts changed or invented: rejected.
    assert not prettier_keeps_facts(DECS, DECS_EXAMPLE.replace("`int list` - the", "`int` - the").replace("`int list` - each", "`int` - each"), allow_example=True)
    assert not prettier_keeps_facts(DECS, DECS_EXAMPLE.replace("`dec` (of type", "`decrement` (of type"), allow_example=True)
    assert not prettier_keeps_facts(DECS, DECS_EXAMPLE.replace("by one", "by two"), allow_example=True)
    assert not prettier_keeps_facts(DECS, DECS_EXAMPLE.replace("`decs [3", "`inc_all [3"), allow_example=True)
    assert not prettier_keeps_facts(DECS, DECS_EXAMPLE.replace("`decs [3", "`map dec [3"), allow_example=True)


async def test_coding_rewrite_flows_through_with_its_example() -> None:
    svc = _svc({"questions": [{"id": 1, "question_text": UPPERS_GOAL, "options": None, "expected_answer": "x"}]})
    out = await svc.prettify_questions(
        [{"id": 1, "type": "FRQ", "question_text": UPPERS, "options": None, "expected_answer": "x"}], "coding", "OCaml"
    )
    assert out[1]["question_text"] == UPPERS_GOAL


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
    assert "**Problem**" in prompt and "**Inputs**" in prompt and "**Examples**" in prompt and "Keep every fact" in prompt


async def test_a_failed_batch_returns_nothing() -> None:
    svc = LLMService()
    svc._complete_json = AsyncMock(side_effect=RuntimeError("down"))  # type: ignore[method-assign]
    out = await svc.prettify_questions(
        [{"id": 1, "type": "FRQ", "question_text": RAW, "options": None, "expected_answer": "x"}], "coding"
    )
    assert out == {}
