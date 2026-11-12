"""MCP interview prep tools (KojoCode, banks, drills, mocks, System Design), end to end over /mcp."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from src.models.lc_sync import LCProgress
from src.models.mock_interview import MockInterviewSession
from src.models.system_design import SDConceptProgress
from src.schemas.attempt_schema import FRQGrade
from src.schemas.leetcode_schema import LCScoresResponse, LCWeaknessResponse, LCWeaknessTopic
from tests.test_mcp_connector import _connect, _rpc, client, seeded  # noqa: F401  (fixtures)

pytestmark = pytest.mark.asyncio

STARTER = "class Solution:\n    def add(self, a, b):\n        ..."
CASES = [{"input_text": f"a = {i}, b = 1", "output_text": str(i + 1)} for i in range(3)]
TESTS_PY = "from cache import Cache\n\ndef run_tests():\n    return [('works', Cache() is not None, '')]\n"


def _problem(**kw) -> dict:
    return {"title": "Add two", "topic": "arrays", "difficulty": "Easy", "description": "Add them.",
            "starter_code": STARTER, "test_cases": CASES, **kw}


def _exercise(title: str) -> dict:
    return {"title": title, "brief": "Build it.", "files": [{"name": "cache.py", "contents": ""}],
            "test_module": TESTS_PY}


def _topic(**kw) -> dict:
    return {
        "title": "Rate limiting",
        "blurb": "Saying no politely.",
        "notes": "word " * 300,
        "video": {"title": "Rate limiters", "url": "https://www.youtube.com/watch?v=dGAgxozNWFE"},
        "visualizer": _exercise("Token bucket"),
        "project": _exercise("Sliding window limiter"),
        "quiz": {
            "mcq": [{"prompt": f"Q{i}", "options": ["a", "b", "c", "d"], "correct_index": 1} for i in range(3)],
            "frq": [{"prompt": f"W{i}", "rubric": "Mentions bursts."} for i in range(5)],
        },
        **kw,
    }


@pytest.fixture
async def call(client):  # noqa: F811
    access = (await _connect(client))["access_token"]

    async def _call(name: str, arguments: dict, expect_error: bool = False) -> dict:
        result = (await _rpc(client, access, "tools/call", {"name": name, "arguments": arguments})).json()["result"]
        assert result["isError"] is expect_error, result
        text = result["content"][0]["text"]
        return text if expect_error else json.loads(text)

    return _call


async def test_custom_problem_round_trip_with_bank_and_drill(client, call) -> None:  # noqa: F811
    made = await call("create_leetcode_problem", _problem())
    slug = made["slug"]
    assert slug.startswith("custom-")

    listed = await call("list_leetcode_problems", {"source": "custom"})
    assert [p["slug"] for p in listed["problems"]] == [slug]
    builtin = await call("list_leetcode_problems", {"source": "builtin", "search": "two sum"})
    assert any(p["slug"] == "two-sum" for p in builtin["problems"])

    # The app reads it like any custom problem.
    app_list = (await client.get("/leetcode/custom-problems")).json()["problems"]
    assert app_list[0]["slug"] == slug and app_list[0]["test_cases"][0]["input_text"] == "a = 0, b = 1"

    bank = await call("create_prep_bank", {"name": "Google", "problem_slugs": ["two-sum", slug], "activate": True})
    assert bank["problem_slugs"] == ["two-sum", slug] and bank["is_active"] is True
    await call("create_prep_bank", {"name": "Bad", "problem_slugs": ["not-a-real-problem"]}, expect_error=True)
    bank = await call("remove_bank_problems", {"bank_id": bank["bank_id"], "problem_slugs": ["two-sum"]})
    assert bank["problem_slugs"] == [slug]

    drills = await call("add_drills", {"problem_slugs": [slug, "two-sum"]})
    assert sorted(drills["added"]) == sorted([slug, "two-sum"])
    again = await call("add_drills", {"problem_slugs": [slug]})
    assert again["already_drilling"] == [slug]
    listing = await call("list_drills", {})
    assert listing["due_now"] == 2
    await call("remove_drills", {"problem_slugs": [slug]}, expect_error=True)  # no confirm
    await call("remove_drills", {"problem_slugs": [slug], "confirm": True})
    assert [d["slug"] for d in (await call("list_drills", {}))["drills"]] == ["two-sum"]

    await call("edit_leetcode_problem", {"slug": slug, "subtopic": "Not a subtopic"}, expect_error=True)
    await call("edit_leetcode_problem", {"slug": slug, "subtopic": "Prefix Sum", "difficulty": "Medium"})
    got = await call("get_leetcode_problem", {"slug": slug})
    assert got["subtopic"] == "Prefix Sum" and got["difficulty"] == "Medium"

    await call("delete_leetcode_problem", {"slug": slug, "confirm": True})
    assert (await client.get("/leetcode/custom-problems")).json()["problems"] == []


async def test_problem_validation(call) -> None:
    await call("create_leetcode_problem", _problem(topic="not-a-topic"), expect_error=True)
    await call("create_leetcode_problem", _problem(starter_code="def add(a, b): ..."), expect_error=True)
    await call("create_leetcode_problem", _problem(test_cases=CASES[:2]), expect_error=True)


async def test_completed_problems(call, seeded, db_session_maker) -> None:  # noqa: F811
    async with db_session_maker() as session:
        session.add(LCProgress(user_id=seeded["beta"].id, problem_slug="two-sum", done=True))
        session.add(LCProgress(user_id=seeded["beta"].id, problem_slug="maximum-subarray", done=False))
        await session.commit()
    done = await call("list_completed_problems", {})
    assert done["total_completed"] == 1 and done["problems"][0]["title"] == "Two Sum"


async def test_mock_interview_create_alongside_unfinished_and_delete(client, call, db_session_maker) -> None:  # noqa: F811
    made = await call("create_mock_interview", {
        "company": "Stripe", "level": "junior", "stages": ["stage1", "stage3"],
        "job_description": "Payments.", "topics": ["arrays"], "problem_slugs": ["two-sum"],
    })
    assert made["url"].endswith(f"/mock-interview/{made['session_id']}/stage1")
    session_row = (await client.get(f"/mock-interview/{made['session_id']}")).json()
    assert session_row["company"] == "custom" and session_row["custom_company"] == "Stripe"
    assert session_row["custom_config"]["problems"][0]["title"] == "Two Sum"

    # An unfinished run (progress synced) no longer blocks a new one; both stay listed.
    async with db_session_maker() as session:
        row = await session.get(MockInterviewSession, made["session_id"])
        row.progress_json = "{}"
        await session.commit()
    second = await call("create_mock_interview", {"company": "google"})
    listed = {m["session_id"] for m in (await call("list_mock_interviews", {}))["interviews"]}
    assert listed == {made["session_id"], second["session_id"]}
    await call("delete_mock_interview", {"session_id": second["session_id"], "confirm": True})

    full = await call("get_mock_interview", {"session_id": made["session_id"]})
    assert full["stages"] == ["stage1", "stage3"]

    await call("delete_mock_interview", {"session_id": made["session_id"], "confirm": True})
    assert (await call("list_mock_interviews", {}))["interviews"] == []
    assert (await call("create_mock_interview", {"company": "google"}))["company"] == "google"


async def test_app_route_deletes_mock_interview(client) -> None:  # noqa: F811
    made = (await client.post("/mock-interview", json={"company": "google"})).json()
    assert (await client.delete(f"/mock-interview/{made['id']}")).status_code == 204
    assert (await client.get(f"/mock-interview/{made['id']}")).status_code == 404


async def test_sd_topic_renders_and_completes_like_a_builtin(client, call, seeded, db_session_maker) -> None:  # noqa: F811
    made = await call("create_sd_topic", _topic())
    assert made["embedded_video"] is True
    concepts = (await client.get("/system-design/custom-topics")).json()
    concept = concepts[0]
    assert concept["id"] == made["concept_id"] and concept["video"]["youtubeId"] == "dGAgxozNWFE"
    assert concept["visualizer"]["kind"] == "visualizer" and concept["visualizer"]["testModule"] == TESTS_PY
    assert concept["quiz"]["mcq"][0] == {"id": "mcq-1", "prompt": "Q0", "options": ["a", "b", "c", "d"],
                                         "correctIndex": 1}

    # Progress and submissions work under the custom concept id.
    cid = made["concept_id"]
    assert (await client.put(f"/system-design/progress/{cid}", json={"subModule": "notes", "done": True})).status_code == 204
    assert (await client.put(f"/system-design/submissions/{cid}:project",
                             json={"files": {"cache.py": "x"}, "ranPassed": True})).status_code == 204

    await call("edit_sd_topic", {"topic_id": made["topic_id"], "video": {"title": "Blog", "url": "https://example.com/rl"}})
    concept = (await client.get("/system-design/custom-topics")).json()[0]
    assert concept["video"] == {"title": "Blog", "url": "https://example.com/rl", "youtubeId": None}

    await call("delete_sd_topic", {"topic_id": made["topic_id"], "confirm": True})
    assert (await client.get("/system-design/custom-topics")).json() == []
    async with db_session_maker() as session:
        left = (await session.execute(select(SDConceptProgress).where(SDConceptProgress.concept_id == cid))).all()
        assert left == []


async def test_sd_topic_validation(call) -> None:
    quiz = _topic()["quiz"]
    await call("create_sd_topic", _topic(quiz={**quiz, "frq": quiz["frq"][:2]}), expect_error=True)
    too_many = [{"prompt": f"W{i}", "rubric": "r"} for i in range(11)]
    await call("create_sd_topic", _topic(quiz={**quiz, "frq": too_many}), expect_error=True)
    bad_exercise = {**_exercise("x"), "test_module": "def tests(): pass"}
    await call("create_sd_topic", _topic(project=bad_exercise), expect_error=True)
    reserved = {**_exercise("x"), "files": [{"name": "sim.py", "contents": ""}]}
    await call("create_sd_topic", _topic(visualizer=reserved), expect_error=True)
    await call("create_sd_topic", _topic(video={"title": "v", "url": "http://insecure.example"}), expect_error=True)


async def test_non_beta_user_is_refused(client, call, seeded, db_session_maker) -> None:  # noqa: F811
    from src.models.user import User

    async with db_session_maker() as session:
        user = await session.get(User, seeded["beta"].id)
        user.is_beta = False
        await session.commit()
    seeded["beta"].is_beta = False
    message = await call("list_prep_banks", {}, expect_error=True)
    assert "beta" in message


async def test_custom_topic_quiz_grades_more_than_five_written_answers(client, call) -> None:  # noqa: F811
    quiz = _topic()["quiz"]
    seven = [{"prompt": f"W{i}", "rubric": "Mentions bursts."} for i in range(7)]
    made = await call("create_sd_topic", _topic(quiz={**quiz, "frq": seven}))
    concept = (await client.get("/system-design/custom-topics")).json()[0]
    assert len(concept["quiz"]["frq"]) == 7

    def body(count: int) -> dict:
        return {
            "notes": concept["notes"],
            "mcq": [{"id": q["id"], "chosenIndex": q["correctIndex"], "correctIndex": q["correctIndex"]}
                    for q in concept["quiz"]["mcq"]],
            "frq": [{"id": q["id"], "prompt": q["prompt"], "rubric": q["rubric"], "answer": "bursts " * 10}
                    for q in concept["quiz"]["frq"][:count]],
        }

    grader = AsyncMock(return_value=FRQGrade(is_correct=True, feedback="Good.", confidence=0.9))
    with patch("src.services.llm_service.LLMService.grade_frq_answer", new=grader):
        graded = await client.post(f"/system-design/quiz/{made['concept_id']}/grade", json=body(7))
        assert graded.status_code == 200, graded.text
        assert graded.json()["frqScore"] == 100 and graded.json()["passed"] is True
        assert grader.await_count == 7
        # The count is checked against the stored topic, not the request.
        short = await client.post(f"/system-design/quiz/{made['concept_id']}/grade", json=body(5))
        assert short.status_code == 400 and "Expected 7" in short.json()["detail"]
    # Built-in concepts still need exactly five.
    builtin = await client.post("/system-design/quiz/caching/grade", json=body(7))
    assert builtin.status_code == 400


async def test_bank_completion_is_separate_from_global_done(client, call, seeded, db_session_maker) -> None:  # noqa: F811
    async with db_session_maker() as session:
        session.add(LCProgress(user_id=seeded["beta"].id, problem_slug="two-sum", done=True))
        await session.commit()
    bank = await call("create_prep_bank", {"name": "NVIDIA OA", "problem_slugs": ["two-sum", "maximum-subarray"]})
    assert bank["done_count"] == 0  # solved before it was added: still cold here
    other = (await client.post("/leetcode/banks", json={"name": "Second"})).json()
    await client.post(f"/leetcode/banks/{other['id']}/problems", json={"problem_slug": "two-sum"})

    marked = (await client.put("/leetcode/banks/completion/two-sum", json={"done": True})).json()
    assert sorted(b["id"] for b in marked["banks"]) == sorted([bank["bank_id"], other["id"]])
    assert all(b["completed_slugs"] == ["two-sum"] for b in marked["banks"])
    assert set(marked["banks"][0]["added_at"]) >= {"two-sum"}
    again = (await client.put("/leetcode/banks/completion/two-sum", json={"done": True})).json()
    assert again["banks"] == []  # already done: nothing changes, timestamp kept

    listed = await call("list_prep_banks", {})
    nvidia = next(b for b in listed["banks"] if b["bank_id"] == bank["bank_id"])
    assert nvidia["completed_in_bank"] == ["two-sum"] and nvidia["done_count"] == 1

    cleared = (await client.put("/leetcode/banks/completion/two-sum", json={"done": False})).json()
    assert all(b["completed_slugs"] == [] for b in cleared["banks"])

    # Removing and re-adding starts a fresh cold run.
    await client.put("/leetcode/banks/completion/two-sum", json={"done": True})
    await call("remove_bank_problems", {"bank_id": bank["bank_id"], "problem_slugs": ["two-sum"]})
    readded = await call("add_bank_problems", {"bank_id": bank["bank_id"], "problem_slugs": ["two-sum"]})
    assert readded["completed_in_bank"] == []


async def test_mock_interview_uses_custom_problem_titles(client, call) -> None:  # noqa: F811
    made_problem = await call("create_leetcode_problem", _problem(title="Rotate the warehouse grid", difficulty="Hard"))
    made = await call("create_mock_interview", {"company": "NVIDIA", "problem_slugs": [made_problem["slug"], "two-sum"]})
    problems = (await client.get(f"/mock-interview/{made['session_id']}")).json()["custom_config"]["problems"]
    assert problems[0] == {"slug": made_problem["slug"], "title": "Rotate the warehouse grid", "difficulty": "Hard"}
    assert problems[1]["title"] == "Two Sum"


async def test_weakness_signals_read_and_log(call, seeded, db_session_maker) -> None:  # noqa: F811
    from src.models.lc_sync import LCStruggleEvent

    async with db_session_maker() as session:
        for _ in range(3):
            session.add(LCStruggleEvent(user_id=seeded["beta"].id, topic="arrays", subtopic="Two Pointers",
                                        event_type="solution_viewed", problem_slug="two-sum"))
        await session.commit()
    # The scorer compares tz-aware datetimes, which SQLite drops; Postgres keeps them.
    scores = LCScoresResponse(weakness=LCWeaknessResponse(topics=[LCWeaknessTopic(topic="arrays", level=3)]))
    with patch("src.services.scoring_service.ScoringService.get_scores", AsyncMock(return_value=scores)) as scorer:
        out = await call("get_kojocode_weakness", {"sensitivity": "high"})
    assert scorer.await_args.kwargs["sensitivity"] == "high"
    assert out["weakness"] == [{"topic": "arrays", "subtopic": None, "level": 3}]
    assert len(out["signals"]) == 3 and out["signals"][0]["type"] == "solution_viewed"

    logged = await call("log_kojocode_signal", {"topic": "arrays", "subtopic": "Two Pointers",
                                                "problem_slug": "two-sum", "rating": "brutal"})
    assert logged["logged"] == "self_rated_brutal"
    with patch("src.services.scoring_service.ScoringService.get_scores", AsyncMock(return_value=scores)):
        assert len((await call("get_kojocode_weakness", {}))["signals"]) == 4

    await call("log_kojocode_signal", {"topic": "nope", "rating": "hard"}, expect_error=True)
    await call("log_kojocode_signal", {"topic": "arrays", "rating": "failed_grade"}, expect_error=True)
    await call("log_kojocode_signal", {"topic": "arrays", "problem_slug": "not-real", "rating": "hard"},
               expect_error=True)


async def test_resume_question_pool_picks_five_and_reports_them(client, call, db_session_maker) -> None:  # noqa: F811
    pool = [f"Walk me through Nosey decision {i}." for i in range(8)]
    await call("create_mock_interview", {"company": "microsoft", "resume_questions": pool[:3]}, expect_error=True)
    made = await call("create_mock_interview", {"company": "microsoft", "stages": ["resume"], "resume_questions": pool})
    sid = made["session_id"]
    assert (await call("get_mock_interview", {"session_id": sid}))["resume_questions"]["picked"] == []

    async with db_session_maker() as session:
        row = await session.get(MockInterviewSession, sid)
        row.resume_text = "Built Nosey, an AI study app. Built Park&Go."
        await session.commit()
    reply = AsyncMock(return_value='{"reply": "Q1", "covered_goals": [], "is_done": false}')
    with patch("src.routes.mock_interview.LLMService.call_kojo", reply):
        first = await client.post(f"/mock-interview/{sid}/resume/grill/message", json={"history": [], "covered_goals": []})
        assert first.status_code == 200, first.text
        await client.post(f"/mock-interview/{sid}/resume/grill/message", json={"history": [], "covered_goals": []})

    info = (await call("get_mock_interview", {"session_id": sid}))["resume_questions"]
    picked = [p["question"] for p in info["picked"]]
    assert len(picked) == 5 and len(set(picked)) == 5 and len(info["unused"]) == 3
    prompts = [c.args[0] for c in reply.await_args_list]
    # The opener asks the first pick, and only it (GH #221: the server hands the model
    # one question per turn). A resumed run asks the same pick.
    assert picked[0] in prompts[0] and not any(q in prompts[0] for q in picked[1:])
    assert prompts[0] == prompts[1]

    await call("set_resume_questions", {"session_id": sid, "questions": pool[3:]})
    assert (await call("get_mock_interview", {"session_id": sid}))["resume_questions"]["picked"] == []


async def test_voice_round_transcripts_reach_the_connector(client, call) -> None:  # noqa: F811
    made = await call("create_mock_interview", {"company": "microsoft", "stages": ["stage3"]})
    sid = made["session_id"]
    reply = AsyncMock(return_value='{"reply": "Tell me about a conflict.", "covered_goals": [], "is_done": false}')
    with patch("src.routes.mock_interview.LLMService.call_kojo", reply):
        await client.post(f"/mock-interview/{sid}/stage3/message", json={"history": []})
        res = await client.post(f"/mock-interview/{sid}/stage3/message", json={
            "message": "My teammate and I disagreed on the schema.",
            "history": [{"role": "interviewer", "content": "Tell me about a conflict."}],
        })
        assert res.status_code == 200, res.text
    lines = (await call("get_mock_interview", {"session_id": sid}))["transcripts"]["stage3"]
    assert [line["role"] for line in lines] == ["interviewer", "user", "interviewer"]
    assert lines[1]["content"].startswith("My teammate")


async def test_speak_rejects_unknown_voice(client) -> None:  # noqa: F811
    assert (await client.post("/mock-interview/speak", json={"text": "hi", "voice": "evil"})).status_code == 422
