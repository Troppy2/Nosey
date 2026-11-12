"""Regression tests for GH #221, replaying what mock session 113 did.

1. The technical round re-asked the optimize question 5+ times (and the approach
   question 3 times): coverage only moved when the model reported it.
2. Template fields ("impact_metrics:", "tech_choice:") and a prompt rule line
   reached the candidate.
3. One resume question was asked 3 times.
4. Only 2 of the 5 picked resume questions were asked: a non-answer covered Q1 and
   the model's coverage report ended the round early.
5. The grade confirmed O(1) space for a hash-set Single Number.
Plus the follow-ups: nudges were counted as hints, constraints are withheld from
the screen, and the hiring committee reads write-ups, never transcripts.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from src.database import get_session
from src.dependencies import get_beta_user, get_current_user
from src.limiter import limiter
from src.main import app
from src.schemas.mock_interview_schema import CodingProblemInfo
from src.services.mock_interview_turns import (
    plan_turn,
    resolve_turn,
    scrub_reply,
    withhold_problem_details,
)

# Session 113's five picked resume questions, in pick order.
PICKED = [
    "Tell me about a time you were stuck on a bug for a long time. How did you get unstuck?",
    "Nosey runs database migrations on deploy. What happens if one fails, and why did you build it that way?",
    "On the Caring Heart site, how did you build the skip link and keyboard navigation?",
    "Explain your hybrid retrieval in Nosey. Where does BM25 fit?",
    "Nosey retries across providers. What counts as a failure?",
]
RESUME_GOALS = ["project_deep_dive", "impact_metrics", "tech_choice", "ownership", "gap_probe"]


# ── Pure turn state ───────────────────────────────────────────────────────────

def test_answer_advances_exactly_one_goal() -> None:
    plan = plan_turn([], RESUME_GOALS, 0, cap=1)
    assert plan.current == "project_deep_dive" and plan.next == "impact_metrics"
    result = resolve_turn(plan, [], RESUME_GOALS, 0, answered_turn=True, judged_done=True)
    assert result.covered == ["project_deep_dive"] and result.followups == 0


def test_unfinished_answer_stays_then_cap_forces_advance() -> None:
    plan = plan_turn([], RESUME_GOALS, 0, cap=1)
    stay = resolve_turn(plan, [], RESUME_GOALS, 0, answered_turn=True, judged_done=False)
    assert stay.covered == [] and stay.followups == 1
    forced = plan_turn([], RESUME_GOALS, stay.followups, cap=1)
    assert forced.must_advance
    result = resolve_turn(forced, [], RESUME_GOALS, 1, answered_turn=True, judged_done=False)
    assert result.covered == ["project_deep_dive"]


# ── Bug 2: scaffolding never reaches the candidate ────────────────────────────

def test_scrub_removes_slot_labels_and_rule_lines_from_session_113() -> None:
    leaked = (
        "Thanks for that, Inah. It's great you layered in security and CI checks. One sentence "
        "acknowledging the previous answer, then the NEXT uncovered question. tech_choice: On the "
        "Caring Heart site, how did you build the skip link and keyboard navigation?"
    )
    clean = scrub_reply(leaked)
    assert "tech_choice" not in clean
    assert "acknowledging the previous answer" not in clean
    assert "uncovered" not in clean
    assert "On the Caring Heart site, how did you build the skip link" in clean

    clean2 = scrub_reply("Glad it passed.\n\nimpact_metrics: Nosey runs database migrations on deploy. What happens if one fails?")
    assert "impact_metrics" not in clean2
    assert clean2.endswith("What happens if one fails?")


def test_scrub_rewrites_goal_talk_in_the_technical_round() -> None:
    clean = scrub_reply(
        "Okay. Before we move to the optimize goal, could you share one thing you'd change? "
        "That's the next goal we're checking."
    )
    assert "goal" not in clean
    assert "Before we move to the follow-up, could you share one thing you'd change?" in clean


def test_scrub_leaves_normal_speech_alone() -> None:
    text = "Tell me about a time you set a goal and missed it. What happened next?"
    assert scrub_reply(text) == text


# ── Realism: constraints are withheld from the screen ─────────────────────────

SINGLE_NUMBER_HTML = (
    "<p>Given a <strong>non-empty</strong>&nbsp;array of integers <code>nums</code>, every element appears "
    "<em>twice</em> except for one. Find that single one.</p>"
    "<p>You must&nbsp;implement a solution with a linear runtime complexity and use&nbsp;only constant&nbsp;"
    "extra space.</p>"
    '<p><strong class="example">Example 1:</strong></p><pre><strong>Input:</strong> nums = [2,2,1]\n'
    "<strong>Output:</strong> 1</pre>"
    "<p><strong>Constraints:</strong></p><ul><li><code>1 &lt;= nums.length &lt;= 3 * 10<sup>4</sup></code></li>"
    "<li>Each element in the array appears twice except for one element which appears only once.</li></ul>"
)


def test_withhold_moves_constraints_and_target_complexity_to_interviewer_notes() -> None:
    problem = CodingProblemInfo(
        title="Single Number",
        slug="single-number",
        difficulty="Easy",
        prompt="Given a non-empty array... (plain copy)",
        prompt_html=SINGLE_NUMBER_HTML,
        source="catalog",
    )
    out = withhold_problem_details(problem)
    assert "Constraints" not in out.prompt_html
    assert "constant" not in out.prompt_html
    assert "Example 1" in out.prompt_html and "Find that single one" in out.prompt_html
    assert "Constraints" in out.interviewer_notes
    assert "constant" in out.interviewer_notes
    assert withhold_problem_details(out) == out  # idempotent


def test_withhold_plain_text_keeps_examples_after_constraints() -> None:
    problem = CodingProblemInfo(
        title="Pairs",
        slug="mock-1",
        difficulty="Easy",
        prompt=(
            "Count the pairs that sum to k.\n\nConstraints:\n- 1 <= n <= 10^5\n\nExample 1:\nInput: [1,2], k=3\n"
            "Output: 1\n\nFollow-up: Can you do it in O(n) time?"
        ),
    )
    out = withhold_problem_details(problem)
    assert "10^5" not in out.prompt and "Follow-up" not in out.prompt
    assert "Example 1" in out.prompt and "Count the pairs" in out.prompt
    assert "10^5" in out.interviewer_notes and "O(n) time" in out.interviewer_notes


# ── Route harness ─────────────────────────────────────────────────────────────

def _row(**extra: Any) -> SimpleNamespace:
    base = dict(
        id=113,
        company="microsoft",
        level="intern",
        custom_company=None,
        custom_config=None,
        resume_text="Inah James. Nosey: AI study app. Caring Heart Assisted Living web developer.",
        resume_questions=json.dumps({"pool": PICKED, "picked": [0, 1, 2, 3, 4]}),
        transcripts=None,
        resume_grill=None,
        resume_screen=None,
        stage1_results=None,
        stage2_submission=None,
        stage3_answers=None,
        overall_feedback=None,
        skill_ratings=None,
        status="pending",
    )
    base.update(extra)
    return SimpleNamespace(**base)


USER = SimpleNamespace(id=7, preferred_name="Inah", full_name="Inah James", role="admin", is_beta=True)


async def _override_session():
    yield AsyncMock()


async def _override_user():
    return USER


class FakeKojo:
    """Scripted call_kojo: records every prompt, returns the queued replies in order."""

    def __init__(self, replies: list[dict]) -> None:
        self.replies = [json.dumps(r) for r in replies]
        self.prompts: list[str] = []

    async def __call__(self, prompt: str, provider=None) -> str:  # noqa: ANN001
        # Patched onto the class as a plain callable: not bound, so no LLMService self.
        self.prompts.append(prompt)
        return self.replies.pop(0)


@pytest.fixture
def harness():
    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = _override_user
    app.dependency_overrides[get_beta_user] = _override_user
    with patch("src.routes.mock_interview.screen_user_input", new=AsyncMock()), patch(
        "src.routes.mock_interview.resolve_request_provider", new=lambda user, requested: requested
    ):
        yield
    app.dependency_overrides.clear()


async def _post(path: str, body: dict) -> dict:
    limiter.reset()
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(path, json=body)
    assert response.status_code == 200, response.text
    return response.json()


# ── Bugs 3 and 4: the resume deep dive asks all 5 questions, once each ───────

async def test_resume_round_asks_each_picked_question_once_and_ends_after_the_fifth(harness) -> None:
    row = _row()
    replies = [{"reply": "Hi Inah. " + PICKED[0], "answered": False}]
    # The model even claims every goal is covered and the round is done, as in session 113.
    replies += [
        {"reply": f"Got it. {q}", "answered": True, "covered_goals": RESUME_GOALS, "is_done": True}
        for q in PICKED[1:]
    ]
    replies += [{"reply": "Thanks, that is the end of the deep dive.", "answered": True}]
    kojo = FakeKojo(replies)
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ), patch("src.routes.mock_interview._save_resume_grill_feedback", new=AsyncMock()) as save:
        history: list[dict] = []
        covered: list[str] = []
        followups = 0
        res = await _post(
            "/mock-interview/113/resume/grill/message",
            {"message": None, "history": [], "covered_goals": [], "followups_on_current": 0},
        )
        # The opener asks question 1 itself (session 113 opened with only "Let's start.").
        assert PICKED[0] in kojo.prompts[0]
        history.append({"role": "interviewer", "content": res["reply"]})
        for i in range(5):
            answer = f"answer {i}"
            res = await _post(
                "/mock-interview/113/resume/grill/message",
                {"message": answer, "history": history, "covered_goals": covered, "followups_on_current": followups},
            )
            history += [{"role": "user", "content": answer}, {"role": "interviewer", "content": res["reply"]}]
            covered, followups = res["covered_goals"], res["followups_on_current"]
            # Exactly one more question covered per answer, never a jump to "all done".
            assert len(covered) == i + 1
            assert res["is_done"] is (i == 4)
            prompt = kojo.prompts[-1]
            if i < 4:
                # This turn's prompt names the NEXT question, not the one just answered.
                assert f'"{PICKED[i + 1]}"' in prompt.split("- If it does not")[0].split("then ask")[-1]
        save.assert_awaited_once()

    # Every picked question was put to the model as the one to ask, once.
    asked = [q for q in PICKED if any(f'"{q}"' in p.split("- If it does not")[0].split("then")[-1] for p in kojo.prompts)]
    assert asked == PICKED


async def test_resume_non_answer_does_not_cover_the_question(harness) -> None:
    row = _row()
    kojo = FakeKojo([{"reply": "Let's start with this: " + PICKED[0], "answered": False}])
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ):
        res = await _post(
            "/mock-interview/113/resume/grill/message",
            {
                "message": "I think we can start",
                "history": [{"role": "interviewer", "content": "Hi Inah. " + PICKED[0]}],
                "covered_goals": [],
                "followups_on_current": 0,
            },
        )
    assert res["covered_goals"] == []
    assert res["followups_on_current"] == 1
    assert res["is_done"] is False


async def test_resume_reply_never_leaks_template_fields(harness) -> None:
    row = _row()
    kojo = FakeKojo(
        [
            {
                "reply": "Thanks for that, Inah. One sentence acknowledging the previous answer, then the NEXT "
                "uncovered question. tech_choice: " + PICKED[2],
                "answered": True,
            }
        ]
    )
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ):
        res = await _post(
            "/mock-interview/113/resume/grill/message",
            {
                "message": "We test in layers before prod.",
                "history": [{"role": "interviewer", "content": PICKED[1]}],
                "covered_goals": ["project_deep_dive"],
                "followups_on_current": 0,
            },
        )
    assert "tech_choice" not in res["reply"]
    assert "uncovered" not in res["reply"]
    assert PICKED[2] in res["reply"]
    # The prompt itself no longer labels questions with slot names.
    assert "impact_metrics:" not in kojo.prompts[0] and "tech_choice:" not in kojo.prompts[0]


# ── Bug 1: the technical round cannot loop on one step ───────────────────────

PROBLEM = {
    "title": "Single Number",
    "slug": "single-number",
    "difficulty": "Easy",
    "prompt": "Every element appears twice except for one. Find that single one.",
    "source": "catalog",
    "interviewer_notes": "Constraints: 1 <= nums.length <= 3 * 10^4. Follow-up: O(1) extra space.",
}
CODE = (
    "class Solution:\n    def singleNumber(self, nums):\n        seen = set()\n        for i in nums:\n"
    "            if i in seen:\n                seen.remove(i)\n            else:\n                seen.add(i)\n"
    "        return list(seen)[0]\n"
)


def _stage2_body(message: str | None, covered: list[str], followups: int, event: str | None = None) -> dict:
    return {
        "message": message,
        "history": [{"role": "interviewer", "content": "Could you share one thing you'd change?"}],
        "covered_goals": covered,
        "problem": PROBLEM,
        "code": CODE,
        "hints_used": 0,
        "minutes_left": 20,
        "event": event,
        "followups_on_current": followups,
    }


async def test_technical_round_moves_past_optimize_even_if_the_model_never_says_done(harness) -> None:
    row = _row()
    covered = ["background", "coding_problem", "approach", "complexity"]
    # Session 113: the model never marked optimize done and asked it again every turn.
    kojo = FakeKojo([{"reply": "Could you share one thing you'd change?", "step_done": False}] * 3)
    followups = 0
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ):
        for turn in range(3):
            res = await _post("/mock-interview/113/stage2/message", _stage2_body(f"I'd use Counter ({turn})", covered, followups))
            covered, followups = res["covered_goals"], res["followups_on_current"]
            if "optimize" in covered:
                break
    assert "optimize" in covered, "the round must leave optimize within its follow-up cap"
    assert turn == 2  # 2 follow-ups allowed, then the third answer moves on
    assert "has run its course" in kojo.prompts[-1]
    assert "Dry run" in kojo.prompts[-1]


async def test_technical_round_advances_when_the_answer_completes_the_step(harness) -> None:
    row = _row()
    covered = ["background", "coding_problem", "approach"]
    kojo = FakeKojo([{"reply": "Okay. Now, can you do it in O(1) extra space?", "step_done": True}])
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ):
        res = await _post("/mock-interview/113/stage2/message", _stage2_body("O(n) time, O(n) space.", covered, 0))
    assert res["covered_goals"] == ["background", "coding_problem", "approach", "complexity"]
    prompt = kojo.prompts[0]
    # The step just answered is judged, and the NEXT step is what Kojo moves to.
    assert "CURRENT STEP, Complexity" in prompt and "next step. Follow-up" in prompt
    # Bug 5 at the source: Kojo must count worst-case auxiliary space before reacting.
    assert "largest size it can reach during the run" in prompt
    # Realism: neutral interviewer, hidden constraints only on request.
    assert "never tell them an answer or the code is right" in prompt
    assert "share one only when they ask" in prompt and "3 * 10^4" in prompt


async def test_nudge_is_never_counted_as_a_hint(harness) -> None:
    row = _row()
    kojo = FakeKojo([{"reply": "How's it going?", "hint_given": True}])
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ):
        res = await _post(
            "/mock-interview/113/stage2/message",
            _stage2_body(None, ["background", "coding_problem"], 3, event="nudge"),
        )
    assert res["hint_given"] is False
    assert res["followups_on_current"] == 3  # a nudge is not an answer


# ── Stage 3 had the same repeat ("final question" asked twice) ───────────────

async def test_behavioral_round_closes_after_five_and_ignores_model_coverage(harness) -> None:
    row = _row()
    goals = [f"behavioral_q{i}" for i in range(1, 6)]
    kojo = FakeKojo(
        [
            {"reply": "Tell me about a conflict.", "answered": True, "covered_goals": goals, "is_done": True},
            {"reply": "Do you have any questions for me?", "answered": True},
        ]
    )
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ):
        first = await _post(
            "/mock-interview/113/stage3/message",
            {"message": "My hackathon story...", "history": [], "covered_goals": [], "followups_on_current": 0},
        )
        assert first["covered_goals"] == ["behavioral_q1"] and first["is_done"] is False
        last = await _post(
            "/mock-interview/113/stage3/message",
            {"message": "The mentoring story...", "history": [], "covered_goals": goals[:4], "followups_on_current": 0},
        )
    assert last["covered_goals"] == goals and last["is_done"] is False
    assert "Do you have any questions for me?" in kojo.prompts[-1]


# ── Bug 5 + hiring committee ──────────────────────────────────────────────────

async def test_grader_checks_worst_case_space_and_stores_the_packet(harness) -> None:
    row = _row()
    graded = {
        "complexity_check": {"time": "O(n)", "space": "O(n)", "candidate_said": "O(1) space", "candidate_correct": False},
        "verdict": "pass",
        "feedback": "Your set can hold about n/2 values, so space is O(n), not O(1).",
        "writeup": {
            "rating": "LEAN HIRE",
            "signals": {"coding": "HIRE", "problem_solving": "LEAN HIRE", "communication": None, "testing": "bogus"},
            "evidence": ["Claimed O(1) space for a hash set."],
            "concerns": ["Space analysis wrong."],
        },
    }
    strongest = AsyncMock(return_value=graded)
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.complete_json_strongest", new=strongest
    ):
        await _post(
            "/mock-interview/113/stage2/submit",
            {"code": CODE, "problem": PROBLEM, "history": [], "hints_used": 0, "samples_passed": 3, "samples_total": 3},
        )
    prompt = strongest.await_args.args[0]
    assert "largest size it can reach during the run" in prompt
    assert "so it is O(n) space even though it ends with one value" in prompt
    assert prompt.index('"complexity_check"') < prompt.index('"verdict"')
    assert "Kojo may have agreed with a wrong answer" in prompt
    stored = json.loads(row.stage2_submission)
    assert stored["complexity_check"]["space"] == "O(n)"
    assert stored["writeup"]["signals"] == {"coding": "HIRE", "problem_solving": "LEAN HIRE"}


async def test_hiring_committee_reads_packets_never_transcripts(harness) -> None:
    secret = "UNIQUE-TRANSCRIPT-LINE-42"
    row = _row(
        transcripts=json.dumps({"stage2": [{"role": "user", "content": secret}]}),
        stage2_submission=json.dumps(
            {
                "code": CODE,
                "feedback": "candidate-facing prose",
                "verdict": "pass",
                "hints_used": 0,
                "problem": {"title": "Single Number", "difficulty": "Easy"},
                "complexity_check": {"time": "O(n)", "space": "O(n)", "candidate_said": "O(1)", "candidate_correct": False},
                "writeup": {
                    "rating": "LEAN HIRE",
                    "signals": {"coding": "HIRE"},
                    "evidence": ["Wrote a correct set-based solution."],
                    "concerns": ["Said O(1) space."],
                },
            }
        ),
    )
    strongest = AsyncMock(return_value={"call": "LEAN HIRE", "skills": {}, "writeup": "Decision."})
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.complete_json_strongest", new=strongest
    ):
        res = await _post("/mock-interview/113/finish", {})
    prompt = strongest.await_args.args[0]
    assert secret not in prompt
    assert "never see transcripts" in prompt
    assert "Wrote a correct set-based solution." in prompt
    assert "space O(n); candidate said: O(1) (incorrect)" in prompt
    assert res["hiring_recommendation"] == "LEAN HIRE"


async def test_resume_without_a_pool_gives_kojo_a_brief_not_a_line_to_read(harness) -> None:
    # Found while verifying: with no prepared pool Kojo read the slot instruction aloud
    # ("Pick ONE specific project or role from the resume and ask how it worked.").
    row = _row(resume_questions=None)
    kojo = FakeKojo([{"reply": "Hi. How did the caching layer in your study app work?", "answered": False}])
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ):
        await _post(
            "/mock-interview/113/resume/grill/message",
            {"message": None, "history": [], "covered_goals": [], "followups_on_current": 0},
        )
    prompt = kojo.prompts[0]
    assert "never say the brief itself" in prompt
    assert "how one specific project or role on the resume actually worked" in prompt
    assert '"how one specific project' not in prompt  # not quoted as a line to read


def test_withhold_generated_problem_keeps_examples_and_balanced_fences() -> None:
    # Session 114: a generated problem lists **Constraints** before **Examples**. The
    # old splitter hid "Examples" too and cut inside a code fence, so the rest of
    # the statement rendered as one faint code block.
    prompt = (
        "**Problem Statement**\n\nYou are given a string `s`. Return it reversed.\n\n"
        "**Constraints**\n- `1 <= len(s) <= 10^4`\n\n"
        "**Examples**\n\n*Example 1*\n```\nInput: s = \"hello\"\nOutput: \"olleh\"\n```\n\n"
        "*Example 2*\n```\nInput: s = \"A\"\nOutput: \"A\"\n```\n"
    )
    out = withhold_problem_details(CodingProblemInfo(title="Mirror", slug="mock-114", difficulty="Easy", prompt=prompt))
    assert "10^4" not in out.prompt and "10^4" in out.interviewer_notes
    assert "Example 1" in out.prompt and "Example 2" in out.prompt
    assert "Example" not in out.interviewer_notes
    assert out.prompt.count("```") % 2 == 0


async def test_problem_handoff_is_said_even_when_the_model_re_greets(harness) -> None:
    # Session 114 (NVIDIA): on the turn the problem went up, Kojo re-asked the
    # background question instead of presenting it.
    row = _row()
    kojo = FakeKojo([{"reply": "Hi Inah, thanks for joining. What are you working on lately?", "step_done": False}])
    body = _stage2_body("I'm building a study app.", ["background"], 0)
    with patch("src.routes.mock_interview._load_session", new=AsyncMock(return_value=row)), patch(
        "src.services.llm_service.LLMService.call_kojo", new=kojo
    ):
        res = await _post("/mock-interview/113/stage2/message", body)
    assert res["coding_problem"]["title"] == "Single Number"
    assert "problem is up on your screen" in res["reply"]
    assert res["covered_goals"] == ["background", "coding_problem"]
