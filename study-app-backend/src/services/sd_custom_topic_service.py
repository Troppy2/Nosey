"""Custom System Design topics: the DB-backed counterpart of the bundled concepts.

Written only by the MCP connector, read by the System Design pages. The stored
content is the frontend Concept shape (data/systemDesign/types.ts) minus id
and order, so the concept page, the Pyodide workspace and the quiz grader
treat a custom topic exactly like a built-in one. Validation mirrors
data/systemDesign/validate.ts, except the notes length, which is looser.

Stateless; instantiate per request.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import parse_qs, urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.system_design import CUSTOM_CONCEPT_PREFIX, SDCustomTopic
from src.utils.exceptions import ResourceNotFoundException

MODULE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\.py$")
RESERVED_MODULES = frozenset({"_sd_tests.py", "sim.py"})
# Built-in topics ship exactly five written questions; a custom topic may carry
# MIN_FRQ to MAX_FRQ, and the grader checks a submission against its stored count.
# Each written answer is one grading LLM call, hence the cap.
MIN_FRQ = 3
MAX_FRQ = 10
YOUTUBE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConceptFileIn(_In):
    name: str = Field(description="Python module basename, e.g. cache.py. Becomes a tab in the workspace.")
    contents: str = Field(default="", max_length=40_000, description="Starter code. May be empty.")
    readonly: bool = Field(default=False, description="Shown but not editable, e.g. a provided backing store.")

    @model_validator(mode="after")
    def _check(self) -> "ConceptFileIn":
        if not MODULE_NAME_PATTERN.match(self.name):
            raise ValueError(f'"{self.name}" is not a plain Python module basename like cache.py')
        if self.name in RESERVED_MODULES:
            raise ValueError(f'"{self.name}" is reserved by the harness')
        return self


class ExerciseIn(_In):
    title: str = Field(min_length=1, max_length=200)
    brief: str = Field(min_length=1, max_length=20_000, description="Markdown: what to build and the constraints.")
    files: list[ConceptFileIn] = Field(min_length=1, max_length=8)
    test_module: str = Field(
        min_length=1,
        max_length=60_000,
        description="Hidden Python test module, never shown to the learner. Must define run_tests() returning a "
        "list of (name, passed, message) tuples; catch exceptions per case so an unfinished solution shows "
        "as failing cases, not a traceback. It imports the learner's files by module name. Runs in the "
        "browser (Pyodide): standard library only, no network, no clock. `import sim` is available: "
        "sim.tick(), sim.record(kind, **fields), sim.snapshot(name, **fields), sim.events(), sim.reset().",
    )
    sim_guide: Optional[str] = Field(
        default=None, max_length=10_000,
        description="Markdown: which sim.record(...) calls the learner adds so the timeline panel replays their run.",
    )

    @model_validator(mode="after")
    def _check(self) -> "ExerciseIn":
        names = [f.name for f in self.files]
        if len(set(names)) != len(names):
            raise ValueError("file names must be unique")
        if all(f.readonly for f in self.files):
            raise ValueError("at least one file must be editable")
        if not re.search(r"def\s+run_tests\s*\(", self.test_module):
            raise ValueError("test_module must define run_tests()")
        return self


class McqIn(_In):
    prompt: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=4, max_length=4, description="Exactly four options.")
    correct_index: int = Field(ge=0, le=3)


class FrqIn(_In):
    prompt: str = Field(min_length=1, max_length=4000)
    rubric: str = Field(
        min_length=1, max_length=4000, description="Model-answer bullet points the grader compares against."
    )


class QuizIn(_In):
    mcq: list[McqIn] = Field(min_length=3, max_length=10)
    frq: list[FrqIn] = Field(
        min_length=MIN_FRQ, max_length=MAX_FRQ, description="3 to 10 written questions, each graded against the notes."
    )


class VideoIn(_In):
    title: str = Field(min_length=1, max_length=200)
    url: str = Field(
        min_length=1, max_length=2000,
        description="https link. YouTube links are embedded on the page; any other site shows as a link.",
    )

    @model_validator(mode="after")
    def _check(self) -> "VideoIn":
        if urlsplit(self.url).scheme != "https":
            raise ValueError("video url must start with https://")
        return self


def youtube_id(url: str) -> Optional[str]:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    candidate: Optional[str] = None
    if host == "youtu.be":
        candidate = parts.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        if parts.path == "/watch":
            candidate = (parse_qs(parts.query).get("v") or [""])[0]
        else:
            segments = parts.path.strip("/").split("/")
            if len(segments) >= 2 and segments[0] in ("embed", "shorts", "live", "v"):
                candidate = segments[1]
    return candidate if candidate and YOUTUBE_ID_PATTERN.match(candidate) else None


class TopicContentIn(_In):
    """Everything a topic page shows. Used whole by create and per field by edit."""

    title: str = Field(min_length=1, max_length=200)
    blurb: str = Field(min_length=1, max_length=300, description="One line for the topic card.")
    notes: str = Field(
        min_length=200, max_length=100_000,
        description="Markdown article the learner reads (and can have read aloud). Built-in topics run 600 to "
        "1200 words. LaTeX in $...$, fenced code blocks allowed.",
    )
    video: Optional[VideoIn] = Field(default=None, description="Optional. Omit when you have no link you trust.")
    visualizer: ExerciseIn = Field(
        description="Small from-scratch build whose sim events replay on a timeline, e.g. 'Build an LRU cache'."
    )
    project: ExerciseIn = Field(
        description="Longer build, often against a provided read-only file, with a real test suite."
    )
    quiz: QuizIn


def exercise_out(kind: str, exercise: ExerciseIn) -> dict[str, Any]:
    out: dict[str, Any] = {
        "kind": kind,
        "title": exercise.title,
        "brief": exercise.brief,
        "files": [f.model_dump() for f in exercise.files],
        "mockPackages": [],
        "testModule": exercise.test_module,
    }
    if exercise.sim_guide:
        out["simGuide"] = exercise.sim_guide
    return out


def video_out(video: Optional[VideoIn]) -> Optional[dict[str, Any]]:
    if video is None:
        return None
    return {"title": video.title, "url": video.url, "youtubeId": youtube_id(video.url)}


def quiz_out(quiz: QuizIn) -> dict[str, Any]:
    return {
        "mcq": [
            {"id": f"mcq-{i + 1}", "prompt": q.prompt, "options": q.options, "correctIndex": q.correct_index}
            for i, q in enumerate(quiz.mcq)
        ],
        "frq": [{"id": f"frq-{i + 1}", "prompt": q.prompt, "rubric": q.rubric} for i, q in enumerate(quiz.frq)],
    }


def build_content(content: TopicContentIn) -> dict[str, Any]:
    """TopicContentIn -> the stored frontend Concept shape (camelCase), title excluded."""
    return {
        "blurb": content.blurb,
        "notes": content.notes,
        "video": video_out(content.video),
        "visualizer": exercise_out("visualizer", content.visualizer),
        "project": exercise_out("project", content.project),
        "quiz": quiz_out(content.quiz),
    }


def to_concept(row: SDCustomTopic, order: int) -> dict[str, Any]:
    """The frontend Concept for this row."""
    return {"id": row.concept_id, "order": order, "title": row.title, **stored_content(row)}


class SDCustomTopicService:
    async def list(self, user_id: int, session: AsyncSession) -> list[SDCustomTopic]:
        return list(
            (
                await session.execute(
                    select(SDCustomTopic).where(SDCustomTopic.user_id == user_id).order_by(SDCustomTopic.id.asc())
                )
            ).scalars().all()
        )

    async def get_owned(self, user_id: int, topic_id: int, session: AsyncSession) -> SDCustomTopic:
        row = (
            await session.execute(
                select(SDCustomTopic).where(SDCustomTopic.id == topic_id, SDCustomTopic.user_id == user_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise ResourceNotFoundException("System Design topic")
        return row

    async def frq_count(self, user_id: int, concept_id: str, session: AsyncSession) -> Optional[int]:
        """Written questions on the user's custom topic, or None for a built-in concept id."""
        if not concept_id.startswith(CUSTOM_CONCEPT_PREFIX):
            return None
        raw_id = concept_id[len(CUSTOM_CONCEPT_PREFIX):]
        if not raw_id.isdigit():
            raise ResourceNotFoundException("System Design topic")
        row = await self.get_owned(user_id, int(raw_id), session)
        return len((stored_content(row).get("quiz") or {}).get("frq") or [])

    async def concepts(self, user_id: int, session: AsyncSession) -> list[dict[str, Any]]:
        return [to_concept(row, index + 1) for index, row in enumerate(await self.list(user_id, session))]


def stored_content(row: SDCustomTopic) -> dict[str, Any]:
    try:
        return json.loads(row.content_json or "{}")
    except ValueError:
        return {}

