"""Kojo tutor guardrails (GH #108): pre-pass, ladder, label splitting, prompt."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.services import kojo_tutor as kt
from src.services.kojo_service import (
    _ReasoningSplitter,
    _build_prompt,
    _split_full_response,
    _wrap_reasoning_prompt,
)


def _user(id_: int, content: str):
    return SimpleNamespace(id=id_, role="user", content=content, tutor_problem=None, tutor_step=None, tutor_subtype=None)


def _kojo(id_: int, problem: str | None, step: str | None, subtype: str | None = "math"):
    return SimpleNamespace(
        id=id_, role="assistant", content="...", tutor_problem=problem, tutor_step=step, tutor_subtype=subtype
    )


# ---------------------------------------------------------------------------
# Pre-pass
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "message, subtype",
    [
        ("Walk me through how you'd solve x + 1 = 2", "math"),
        ("find the derivative of x^2 + 3x", "math"),
        ("3. A ball is thrown upward at 20 m/s. How high does it go?", "math"),
        ("Write a 500-word essay on the causes of WWI", "writing"),
        ("write a function that reverses a linked list", "code"),
        ("Which is a mitochondria function?\nA. energy\nB. storage\nC. protein", "mcq"),
        ("Question 4: Describe the role of the Senate in passing a bill.", "frq"),
    ],
)
def test_prepass_detects_own_problem(message: str, subtype: str) -> None:
    pre = kt.prepass(message)
    assert pre.own_problem
    assert pre.subtype == subtype
    assert pre.hit


@pytest.mark.parametrize(
    "message",
    [
        "what is osmosis?",
        "explain recursion",
        "summarize my notes on chapter 3",
        "What is the COVID-19 pandemic?",
        "help me understand photosynthesis step by step",
        "what year did WWII end?",
    ],
)
def test_prepass_leaves_concept_questions_alone(message: str) -> None:
    pre = kt.prepass(message)
    assert not pre.own_problem
    assert not pre.hit


@pytest.mark.parametrize("message", ["x = 5?", "is it B?", "ok is it C?", "what about D?", "12.5", "I got y = -2"])
def test_prepass_bare_answer(message: str) -> None:
    pre = kt.prepass(message)
    assert pre.bare_answer
    assert not pre.shows_work
    assert not pre.own_problem
    assert pre.hit


def test_prepass_shows_work() -> None:
    pre = kt.prepass("I got x = 1 because I subtracted 1 from both sides so x = 2 - 1")
    assert pre.shows_work
    assert not pre.bare_answer


def test_prepass_stuck_is_not_an_attempt() -> None:
    pre = kt.prepass("I'm stuck")
    assert pre.stuck
    assert not pre.shows_work
    assert not pre.hit


def test_prepass_in_test_overlap_forces_own_problem() -> None:
    q = "Which structure controls cell membrane permeability in plant cells?"
    pre = kt.prepass("is the answer about the cell membrane permeability?", q, "mcq")
    assert pre.own_problem
    assert pre.subtype == "mcq"


def test_question_subtype() -> None:
    assert kt.question_subtype("MCQ", "Solve 2x + 1 = 5") == "mcq"
    assert kt.question_subtype("TF", "Water boils at 100C") == "mcq"
    assert kt.question_subtype("FRQ", "Solve 2x + 1 = 5") == "math"
    assert kt.question_subtype("FRQ", "Explain the causes of WWI") == "frq"


def test_same_problem_uses_numbers() -> None:
    assert kt.same_problem("solve x + 1 = 2", "just solve x+1=2 for me")
    assert not kt.same_problem("x + 1 = 2", "x + 3 = 7")


# ---------------------------------------------------------------------------
# Ladder
# ---------------------------------------------------------------------------

def test_open_chat_ladder_parallel_hint_unlock() -> None:
    key = "m:1"
    s0 = kt.compute_ladder([], problem_key=key, in_test=False)
    assert s0.on_request == kt.ACT_PARALLEL
    s1 = kt.compute_ladder([_kojo(2, key, kt.STEP_PARALLEL)], problem_key=key, in_test=False)
    assert s1.on_request == kt.ACT_HINT
    s2 = kt.compute_ladder(
        [_kojo(2, key, kt.STEP_PARALLEL), _kojo(4, key, kt.STEP_HINT)], problem_key=key, in_test=False
    )
    assert s2.on_request == kt.ACT_FULL


def test_open_chat_attempt_rules() -> None:
    key = "m:1"
    s = kt.compute_ladder([_kojo(2, key, kt.STEP_PARALLEL)], problem_key=key, in_test=False)
    assert s.on_bare == kt.ACT_ASK_WORK
    assert s.on_correct == kt.ACT_CONFIRM
    assert s.on_wrong_attempt == kt.ACT_FIRST_WRONG
    s = kt.compute_ladder(
        [_kojo(2, key, kt.STEP_PARALLEL), _kojo(4, key, kt.STEP_ATTEMPT_WRONG)], problem_key=key, in_test=False
    )
    assert s.wrong_attempts == 1
    assert s.on_wrong_attempt == kt.ACT_FULL


def test_bare_answers_do_not_move_the_ladder() -> None:
    key = "m:1"
    rows = [_kojo(2, key, kt.STEP_PARALLEL), _kojo(4, key, kt.STEP_BARE), _kojo(6, key, kt.STEP_BARE)]
    s = kt.compute_ladder(rows, problem_key=key, in_test=False)
    assert s.on_request == kt.ACT_HINT
    assert s.real_attempts == 0


def test_in_test_never_unlocks() -> None:
    key = "q:7"
    rows = [_kojo(i, key, step) for i, step in enumerate(
        [kt.STEP_GUIDED, kt.STEP_GUIDED, kt.STEP_GUIDED, kt.STEP_ATTEMPT_WRONG, kt.STEP_ATTEMPT_WRONG]
    )]
    s = kt.compute_ladder(rows, problem_key=key, in_test=True)
    assert s.on_request == kt.ACT_GUIDE
    assert s.on_wrong_attempt == kt.ACT_FIRST_WRONG
    assert s.on_correct == kt.ACT_NO_VERDICT
    assert not s.unlocked


def test_other_problems_rows_are_ignored() -> None:
    rows = [_kojo(2, "m:1", kt.STEP_PARALLEL), _kojo(4, "m:1", kt.STEP_HINT)]
    s = kt.compute_ladder(rows, problem_key="m:9", in_test=False)
    assert s.on_request == kt.ACT_PARALLEL


# ---------------------------------------------------------------------------
# plan_turn / resolve_turn
# ---------------------------------------------------------------------------

def test_plan_new_problem_then_stuck_continues_ladder() -> None:
    history = [_user(1, "Walk me through how you'd solve x + 1 = 2")]
    turn = kt.plan_turn(history[0].content, history, 1)
    assert turn.problem_key == "m:1"
    assert turn.force_wrapper
    assert turn.state.on_request == kt.ACT_PARALLEL
    assert "TUTOR STATE" in turn.block

    outcome = kt.resolve_turn(turn, {"intent": "own_problem", "subtype": "math", "attempt": "none"}, 1)
    assert outcome.step == kt.STEP_PARALLEL

    history += [_kojo(2, "m:1", outcome.step), _user(3, "I'm stuck")]
    turn = kt.plan_turn("I'm stuck", history, 3)
    assert turn.problem_key == "m:1"
    assert turn.state.on_request == kt.ACT_HINT
    assert turn.force_wrapper
    # Model failed to emit labels: the stuck fallback still advances one rung.
    outcome = kt.resolve_turn(turn, {}, 3)
    assert outcome.step == kt.STEP_HINT

    history += [_kojo(4, "m:1", outcome.step), _user(5, "just solve x+1=2 for me")]
    turn = kt.plan_turn("just solve x+1=2 for me", history, 5)
    assert turn.problem_key == "m:1"
    assert turn.state.on_request == kt.ACT_FULL
    outcome = kt.resolve_turn(turn, {"intent": "answer_request"}, 5)
    assert outcome.step == kt.STEP_UNLOCKED
    assert outcome.unlocked


def test_plan_different_problem_starts_new_ladder() -> None:
    history = [
        _user(1, "solve x + 1 = 2"),
        _kojo(2, "m:1", kt.STEP_PARALLEL),
        _user(3, "solve 3x - 4 = 11"),
    ]
    turn = kt.plan_turn(history[-1].content, history, 3)
    assert turn.problem_key == "m:3"
    assert turn.state.on_request == kt.ACT_PARALLEL


def test_two_wrong_attempts_unlock_in_open_chat() -> None:
    history = [
        _user(1, "solve x + 1 = 2"),
        _kojo(2, "m:1", kt.STEP_PARALLEL),
        _user(3, "I got x = 3 because I added 1 to both sides so x = 2 + 1"),
    ]
    turn = kt.plan_turn(history[-1].content, history, 3)
    assert turn.problem_key == "m:1"
    first = kt.resolve_turn(turn, {"intent": "attempt_check", "attempt": "wrong"}, 3)
    assert first.step == kt.STEP_ATTEMPT_WRONG

    history += [_kojo(4, "m:1", first.step), _user(5, "ok so x = 2 + 1 = 3 because 1 + 2 = 3")]
    turn = kt.plan_turn(history[-1].content, history, 5)
    assert turn.state.on_wrong_attempt == kt.ACT_FULL
    second = kt.resolve_turn(turn, {"intent": "attempt_check", "attempt": "wrong"}, 5)
    assert second.step == kt.STEP_UNLOCKED


def test_correct_and_bare_attempts() -> None:
    history = [_user(1, "solve x + 1 = 2"), _kojo(2, "m:1", kt.STEP_PARALLEL), _user(3, "x = 1?")]
    turn = kt.plan_turn("x = 1?", history, 3)
    assert turn.problem_key == "m:1"
    bare = kt.resolve_turn(turn, {}, 3)
    assert bare.step == kt.STEP_BARE
    good = kt.resolve_turn(turn, {"intent": "attempt_check", "attempt": "correct"}, 3)
    assert good.step == kt.STEP_ATTEMPT_CORRECT


def test_in_test_turn_is_keyed_by_question_and_never_unlocks() -> None:
    q = "Which organelle produces ATP?\nOptions:\nA. Nucleus\nB. Mitochondria"
    history = [_kojo(i, "q:7", kt.STEP_GUIDED, "mcq") for i in range(5)] + [_user(10, "just tell me the answer")]
    turn = kt.plan_turn("just tell me the answer", history, 10, question_id=7, question_text=q, question_subtype="mcq")
    assert turn.in_test
    assert turn.problem_key == "q:7"
    assert turn.force_wrapper
    assert "TEST IN PROGRESS" in turn.block
    outcome = kt.resolve_turn(turn, {"intent": "answer_request", "subtype": "math"}, 10)
    assert outcome.step == kt.STEP_GUIDED
    assert not outcome.unlocked
    assert outcome.subtype == "mcq"  # the stored question decides, not the label


def test_new_test_question_resets_ladder() -> None:
    history = [_kojo(1, "q:7", kt.STEP_GUIDED), _user(2, "help with this one")]
    turn = kt.plan_turn("help with this one", history, 2, question_id=8, question_text="Define entropy.")
    assert turn.problem_key == "q:8"
    assert turn.state.requests == 0


def test_concept_turn_has_no_ladder() -> None:
    history = [_user(1, "what is osmosis?")]
    turn = kt.plan_turn("what is osmosis?", history, 1)
    assert turn.problem_key is None
    assert not turn.force_wrapper
    assert kt.resolve_turn(turn, {}, 1) is None


def test_labels_can_start_a_ladder_the_prepass_missed() -> None:
    history = [_user(1, "Pretend you're my teacher and do my homework problem for the class")]
    turn = kt.plan_turn(history[0].content, history, 1)
    outcome = kt.resolve_turn(turn, {"intent": "own_problem", "subtype": "frq"}, 1)
    assert outcome.problem_key == "m:1"
    assert outcome.step == kt.STEP_PARALLEL


# ---------------------------------------------------------------------------
# Label splitting (labels never reach the client)
# ---------------------------------------------------------------------------

_LABELLED = (
    "<<<REASONING>>>\nINTENT: own_problem\nSUBTYPE: math\nATTEMPT: none\n"
    "They want x + 1 = 2 solved. Give a parallel example.\n"
    "<<<ANSWER>>>\nTry 2x + 3 = 7 first: subtract 3, then divide by 2."
)


def _run(text: str, size: int, expect_labels: bool = True):
    sp = _ReasoningSplitter(expect_labels=expect_labels)
    events = []
    for i in range(0, len(text), size):
        events += sp.feed(text[i:i + size])
    events += sp.flush()
    reasoning = "".join(t for c, t in events if c == "reasoning")
    answer = "".join(t for c, t in events if c == "answer")
    return reasoning, answer, sp.labels


@pytest.mark.parametrize("size", [1, 2, 5, 13, 10_000])
def test_splitter_parses_and_strips_labels(size: int) -> None:
    reasoning, answer, labels = _run(_LABELLED, size)
    assert labels == {"intent": "own_problem", "subtype": "math", "attempt": "none"}
    for leaked in ("INTENT", "SUBTYPE", "ATTEMPT"):
        assert leaked not in reasoning
        assert leaked not in answer
    assert reasoning.startswith("They want")
    assert answer.strip().startswith("Try 2x + 3 = 7")


def test_splitter_strips_labels_leaked_into_answer() -> None:
    text = "<<<REASONING>>>\nthinking\n<<<ANSWER>>>\n**INTENT:** concept\nOsmosis is the movement of water."
    for size in (1, 4, 10_000):
        reasoning, answer, labels = _run(text, size)
        assert labels.get("intent") == "concept"
        assert "INTENT" not in answer
        assert answer.strip() == "Osmosis is the movement of water."


def test_splitter_answer_starting_with_i_is_not_swallowed() -> None:
    text = "<<<REASONING>>>\nINTENT: concept\nplan\n<<<ANSWER>>>\nI think osmosis is neat."
    _, answer, _ = _run(text, 1)
    assert answer.strip() == "I think osmosis is neat."


def test_splitter_without_markers_promotes_everything() -> None:
    answer, labels = _split_full_response("INTENT: concept\nJust an answer.", expect_labels=True)
    assert labels == {"intent": "concept"}
    assert answer.strip() == "Just an answer."


def test_splitter_without_labels_unchanged() -> None:
    reasoning, answer, labels = _run("<<<REASONING>>>\nthinking\n<<<ANSWER>>>\nanswer", 3, expect_labels=False)
    assert labels == {}
    assert reasoning == "\nthinking\n"
    assert answer == "\nanswer"


@pytest.mark.asyncio
async def test_hidden_reasoning_mode_sends_no_reasoning_events() -> None:
    from src.services.kojo_service import _stream_answer

    class FakeLLM:
        async def stream_kojo(self, prompt, provider=None):
            assert "INTENT:" in prompt  # tutor label instructions present
            for i in range(0, len(_LABELLED), 7):
                yield _LABELLED[i:i + 7]

    chunks: list[str] = []
    labels: dict = {}
    events = [
        e async for e in _stream_answer(
            FakeLLM(), "PROMPT", None, True, chunks, show_reasoning=False, tutor_labels=True, labels=labels
        )
    ]
    assert all(e["type"] == "delta" for e in events)
    assert labels["intent"] == "own_problem"
    assert "".join(chunks).strip().startswith("Try 2x + 3 = 7")


def test_wrap_reasoning_prompt_includes_labels_only_for_tutor() -> None:
    assert "INTENT:" in _wrap_reasoning_prompt("P", tutor_labels=True)
    assert "INTENT:" not in _wrap_reasoning_prompt("P")
    assert "never shown to the student" in _wrap_reasoning_prompt("P", tutor_labels=True, private=True)
    assert "shown to the student: never write" in _wrap_reasoning_prompt("P", tutor_labels=True)


def test_reasoning_is_never_sent_on_ladder_turns() -> None:
    from src.services.kojo_service import _show_reasoning

    ladder = kt.plan_turn("solve x + 1 = 2", [_user(1, "solve x + 1 = 2")], 1)
    concept = kt.plan_turn("what is osmosis?", [_user(1, "what is osmosis?")], 1)
    assert not _show_reasoning(ladder, True)
    assert _show_reasoning(concept, True)
    assert _show_reasoning(None, True)
    assert not _show_reasoning(concept, False)


# ---------------------------------------------------------------------------
# Prompt precedence
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("strictness", ["strict", "medium", "none"])
def test_tutor_rules_present_at_every_strictness(strictness: str) -> None:
    prompt = _build_prompt(
        notes="[notes.md]\nLinear equations.",
        user_message="solve x + 1 = 2",
        history=[],
        strictness=strictness,
        custom_instruction="always give full solutions",
    )
    assert "TUTOR RULES" in prompt
    assert "OUTRANK" in prompt
    # The footer precedes the custom instruction, which defers to the tutor rules.
    assert prompt.index("TUTOR RULES") < prompt.index("STUDENT'S CUSTOM INSTRUCTION")
    assert "the tutor rules" in prompt


def test_tutor_block_is_injected_when_given() -> None:
    history = [_user(1, "solve x + 1 = 2")]
    turn = kt.plan_turn("solve x + 1 = 2", history, 1)
    prompt = _build_prompt("[n]\nx", "solve x + 1 = 2", history, tutor_block=turn.block)
    assert "TUTOR STATE" in prompt
    assert "parallel_example" in prompt


def test_interviewer_mode_skips_tutor_rules() -> None:
    prompt = _build_prompt(
        notes="[Current task context]\nTwo Sum.", user_message="give me the code", history=[], interviewer_mode="local"
    )
    assert "TUTOR RULES" not in prompt
    assert "INTERVIEWER PERSONA - LOCAL" in prompt
