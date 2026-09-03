"""LLM quality gate for the episode formats (spec step 3).

Runs generate_podcast_episode and generate_lecture_episode against REAL folder
notes on two providers (groq, ollama) and programmatically sanity-checks the
output: two-voice dialogue, checkpoint ordering/validity, slide budget, and
echo removal. Full output goes to a JSONL log for human inspection.

Run from study-app-backend: ../.venv/Scripts/python.exe scripts/quality_gate_episodes.py
"""

import asyncio
import json

from sqlalchemy import select

from src.database import async_session_maker
from src.models.folder import Folder
from src.services.file_service import FileService
from src.services.llm_service import LLMService

if hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

LOG_PATH = "scripts/episode_quality_gate_output.jsonl"


def norm(s: str) -> str:
    import re

    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


async def fetch_notes() -> str:
    """Real notes from the largest-content folder we can find."""
    async with async_session_maker() as session:
        rows = (await session.execute(select(Folder.id, Folder.user_id).limit(20))).all()
        best = ("", 0)
        for folder_id, user_id in rows:
            try:
                content = await FileService().get_folder_files_content(folder_id, user_id, session)
            except Exception:
                continue
            if len(content) > best[1]:
                best = (content, len(content))
        return best[0][:12000]


def summarize(episode: dict, kind: str) -> dict:
    turns = episode.get("turns", [])
    checkpoints = episode.get("checkpoints", [])
    speakers = sorted({t["speaker"] for t in turns})
    after_turns = [int(c["after_turn"]) for c in checkpoints]
    result = {
        "kind": kind,
        "title": episode.get("title"),
        "turn_count": len(turns),
        "speakers": speakers,
        "checkpoint_count": len(checkpoints),
        "after_turns": after_turns,
        "after_turns_strictly_increasing": after_turns == sorted(set(after_turns)) and len(after_turns) == len(set(after_turns)),
        "checkpoints_in_range": all(1 <= a < len(turns) - 1 for a in after_turns) if after_turns else False,
    }
    if kind == "lecture":
        slides = episode.get("slides", [])
        result["slide_count"] = len(slides)
        result["slide_starts"] = [int(s["start_turn"]) for s in slides]
        result["first_slide_at_zero"] = bool(slides) and int(slides[0]["start_turn"]) == 0
        result["slides_sorted"] = [int(s["start_turn"]) for s in slides] == sorted(
            int(s["start_turn"]) for s in slides
        )
        # Crude echo check: any narration sentence that equals a bullet verbatim.
        active = []
        slide_i = 0
        for turn_i in range(len(turns)):
            while slide_i + 1 < len(slides) and int(slides[slide_i + 1]["start_turn"]) <= turn_i:
                slide_i += 1
            active.append(slide_i)
        echoes = 0
        for turn_i, turn in enumerate(turns):
            bullets = {norm(str(b)) for b in slides[active[turn_i]]["bullets"]}
            for sentence in turn["text"].split("."):
                if norm(sentence) in bullets:
                    echoes += 1
        result["verbatim_bullet_echoes_after_strip"] = echoes
    return result


async def run_one(llm: LLMService, notes: str, provider: str) -> None:
    print(f"\n=== provider={provider} ===")
    for kind, fn in (
        ("podcast", llm.generate_podcast_episode),
        ("lecture", llm.generate_lecture_episode),
    ):
        try:
            episode = await fn(notes, provider=provider)
        except Exception as exc:  # noqa: BLE001 - quality gate reports every failure
            record = {"provider": provider, "kind": kind, "error": f"{type(exc).__name__}: {exc}"}
            print(json.dumps(record))
            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
            continue
        summary = summarize(episode, kind)
        summary["provider"] = provider
        print(json.dumps(summary))
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({**summary, "episode": episode}, ensure_ascii=False) + "\n")


async def main() -> None:
    notes = await fetch_notes()
    print(f"notes length: {len(notes)}")
    llm = LLMService()
    # Every reachable provider in one pass; ollama is the auto default. groq and
    # gemini 404 on their configured model names (pre-existing env issue, see
    # INDEX history), so those records are expected failures, not code bugs.
    for provider in ("gemini", "groq", "claude", "ollama"):
        await run_one(llm, notes, provider)


if __name__ == "__main__":
    asyncio.run(main())