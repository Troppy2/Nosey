"""Pattern Trails content writer: upserts topics, subtopics (paths), steps and gate
items by slug. Shared by the Sliding window seed and the MCP tools, so both go
through the same validation. Idempotent: running it twice changes nothing.

A step or gate item whose problem is not in the built-in KojoCode catalog cannot
run in the editor, so it is skipped and reported (`skipped_*`) instead of being
written. Add the problem to the catalog, run the upsert again, and it fills in.
Positions are kept compact (1..n in the order given), because the rules treat a
path as `count = number of steps`.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.pattern_trail import PTGateItem, PTStep, PTSubtopic, PTTopic
from src.services import lc_catalog
from src.services.pattern_trails import rules
from src.utils.exceptions import ValidationException

_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DIFFICULTIES = ("Easy", "Medium", "Hard")


def _check_slug(value: str) -> str:
    value = value.strip()
    if not _SLUG.match(value) or len(value) > 120:
        raise ValueError("use lowercase letters, numbers and hyphens, up to 120 characters")
    return value


class StepIn(BaseModel):
    problem_slug: str = Field(min_length=1, max_length=200)
    # Null = take the catalog difficulty.
    difficulty: Optional[str] = None
    time_limit_s: Optional[int] = Field(default=None, ge=60, le=7200)

    @field_validator("difficulty")
    @classmethod
    def _difficulty(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in DIFFICULTIES:
            raise ValueError("difficulty is Easy, Medium or Hard")
        return value


class SubtopicIn(BaseModel):
    slug: str
    title: str = Field(min_length=1, max_length=160)
    summary: str = Field(default="", max_length=400)
    lecture_slug: Optional[str] = Field(default=None, max_length=120)
    cues: list[str] = Field(default_factory=list, max_length=8)
    template_code: str = Field(default="", max_length=6000)
    steps: list[StepIn] = Field(default_factory=list, max_length=rules.STEPS_PER_PATH)

    @field_validator("slug")
    @classmethod
    def _clean_slug(cls, value: str) -> str:
        return _check_slug(value)


class GateItemIn(BaseModel):
    problem_slug: str = Field(min_length=1, max_length=200)
    difficulty: Optional[str] = None
    # Exactly one of: a subtopic slug of this topic, or a bare pattern key + title.
    right_subtopic_slug: Optional[str] = None
    right_pattern_key: Optional[str] = Field(default=None, max_length=120)
    right_pattern_title: Optional[str] = Field(default=None, max_length=160)
    cue: str = Field(min_length=1, max_length=400)
    statement_override: Optional[str] = Field(default=None, max_length=4000)


class TopicIn(BaseModel):
    slug: str
    title: str = Field(min_length=1, max_length=160)
    sort_order: int = 0
    icon_key: Optional[str] = Field(default=None, max_length=60)
    subtopics: list[SubtopicIn] = Field(default_factory=list, max_length=12)
    gate_items: list[GateItemIn] = Field(default_factory=list, max_length=40)

    @field_validator("slug")
    @classmethod
    def _clean_slug(cls, value: str) -> str:
        return _check_slug(value)


@dataclass
class ContentReport:
    topic: str = ""
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped_steps: list[str] = field(default_factory=list)
    skipped_gate_items: list[str] = field(default_factory=list)
    skipped_subtopics: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "topic": self.topic,
            "created": self.created,
            "updated": self.updated,
            "skipped_steps": self.skipped_steps,
            "skipped_gate_items": self.skipped_gate_items,
            "skipped_subtopics": self.skipped_subtopics,
            "note": (
                "Skipped entries use problems that are not in the built-in catalog yet. Add them to "
                "leetcodeTaxonomy.ts (then regenerate lc_catalog.txt) and run this again."
                if self.skipped_steps or self.skipped_gate_items or self.skipped_subtopics
                else ""
            ),
        }


def _difficulty(step_difficulty: Optional[str], slug: str) -> str:
    known = lc_catalog.get(slug)
    return step_difficulty or (known.difficulty if known else "Medium")


async def upsert_topic(session: AsyncSession, data: TopicIn) -> ContentReport:
    """Write one topic and everything under it. Commits once at the end."""
    report = ContentReport(topic=data.slug)

    topic = (await session.execute(select(PTTopic).where(PTTopic.slug == data.slug))).scalar_one_or_none()
    if topic is None:
        topic = PTTopic(slug=data.slug, title=data.title, sort_order=data.sort_order, icon_key=data.icon_key)
        session.add(topic)
        report.created.append(f"topic:{data.slug}")
    else:
        topic.title, topic.sort_order, topic.icon_key = data.title, data.sort_order, data.icon_key
        report.updated.append(f"topic:{data.slug}")
    await session.flush()

    slug_to_id: dict[str, int] = {}
    for order, sub_in in enumerate(data.subtopics):
        known_steps = [s for s in sub_in.steps if lc_catalog.get(s.problem_slug) is not None]
        report.skipped_steps += [f"{sub_in.slug}:{s.problem_slug}" for s in sub_in.steps if s not in known_steps]
        if not known_steps:
            report.skipped_subtopics.append(sub_in.slug)
            continue

        other = (
            await session.execute(select(PTSubtopic).where(PTSubtopic.slug == sub_in.slug))
        ).scalar_one_or_none()
        if other is not None and other.topic_id != topic.id:
            raise ValidationException(f"Subtopic slug '{sub_in.slug}' already belongs to another topic.")
        sub = other
        values = dict(
            title=sub_in.title,
            summary=sub_in.summary,
            sort_order=order,
            lecture_slug=sub_in.lecture_slug,
            cues_json=json.dumps([c.strip() for c in sub_in.cues if c.strip()]),
            template_code=sub_in.template_code,
        )
        if sub is None:
            sub = PTSubtopic(topic_id=topic.id, slug=sub_in.slug, **values)
            session.add(sub)
            report.created.append(f"subtopic:{sub_in.slug}")
        else:
            for key, value in values.items():
                setattr(sub, key, value)
            report.updated.append(f"subtopic:{sub_in.slug}")
        await session.flush()
        slug_to_id[sub_in.slug] = sub.id
        await _write_steps(session, sub, known_steps)

    for item in data.gate_items:
        await _write_gate_item(session, topic, slug_to_id, item, report)

    await session.commit()
    return report


async def _write_steps(session: AsyncSession, sub: PTSubtopic, steps: list[StepIn]) -> None:
    existing = {
        row.problem_slug: row
        for row in (await session.execute(select(PTStep).where(PTStep.subtopic_id == sub.id))).scalars()
    }
    # Park every position out of the way first, so reordering never trips the
    # (subtopic_id, position) unique constraint mid-update.
    for row in existing.values():
        row.position = 1000 + row.id
    await session.flush()
    wanted = {s.problem_slug for s in steps}
    for slug, row in existing.items():
        if slug not in wanted:
            await session.delete(row)
    await session.flush()
    for position, step in enumerate(steps, start=1):
        row = existing.get(step.problem_slug)
        difficulty = _difficulty(step.difficulty, step.problem_slug)
        if row is None:
            session.add(
                PTStep(
                    subtopic_id=sub.id,
                    position=position,
                    problem_slug=step.problem_slug,
                    difficulty=difficulty,
                    time_limit_s=step.time_limit_s,
                )
            )
        else:
            row.position, row.difficulty, row.time_limit_s = position, difficulty, step.time_limit_s
    await session.flush()


async def _write_gate_item(
    session: AsyncSession,
    topic: PTTopic,
    slug_to_id: dict[str, int],
    item: GateItemIn,
    report: ContentReport,
) -> None:
    label = f"{topic.slug}:{item.problem_slug}"
    if lc_catalog.get(item.problem_slug) is None:
        report.skipped_gate_items.append(label)
        return
    right_id: Optional[int] = None
    if item.right_subtopic_slug:
        right_id = slug_to_id.get(item.right_subtopic_slug)
        if right_id is None:
            # The path it points at was skipped (no known problems yet).
            report.skipped_gate_items.append(label)
            return
        if item.right_pattern_key or item.right_pattern_title:
            raise ValidationException("Give right_subtopic_slug or a pattern key and title, not both.")
    elif not (item.right_pattern_key and item.right_pattern_title):
        raise ValidationException(
            f"Gate item {item.problem_slug}: set right_subtopic_slug, or right_pattern_key and right_pattern_title."
        )

    row = (
        await session.execute(
            select(PTGateItem).where(PTGateItem.topic_id == topic.id, PTGateItem.problem_slug == item.problem_slug)
        )
    ).scalar_one_or_none()
    values = dict(
        difficulty=_difficulty(item.difficulty, item.problem_slug),
        right_subtopic_id=right_id,
        right_pattern_key=None if right_id else item.right_pattern_key,
        right_pattern_title=None if right_id else item.right_pattern_title,
        cue=item.cue,
        statement_override=item.statement_override,
    )
    if row is None:
        session.add(PTGateItem(topic_id=topic.id, problem_slug=item.problem_slug, **values))
        report.created.append(f"gate:{label}")
    else:
        for key, value in values.items():
            setattr(row, key, value)
        report.updated.append(f"gate:{label}")


async def list_trails(session: AsyncSession) -> list[dict]:
    """Every topic with its paths, steps and gate pool, for the MCP list tool."""
    topics = (await session.execute(select(PTTopic).order_by(PTTopic.sort_order, PTTopic.id))).scalars().all()
    out: list[dict] = []
    for topic in topics:
        subs = (
            await session.execute(
                select(PTSubtopic).where(PTSubtopic.topic_id == topic.id).order_by(PTSubtopic.sort_order, PTSubtopic.id)
            )
        ).scalars().all()
        sub_out = []
        for sub in subs:
            steps = (
                await session.execute(select(PTStep).where(PTStep.subtopic_id == sub.id).order_by(PTStep.position))
            ).scalars().all()
            sub_out.append(
                {
                    "slug": sub.slug,
                    "title": sub.title,
                    "lecture_slug": sub.lecture_slug,
                    "steps": [
                        {"position": s.position, "problem_slug": s.problem_slug, "difficulty": s.difficulty}
                        for s in steps
                    ],
                }
            )
        gate = (await session.execute(select(PTGateItem).where(PTGateItem.topic_id == topic.id))).scalars().all()
        out.append(
            {
                "slug": topic.slug,
                "title": topic.title,
                "subtopics": sub_out,
                "gate_items": [g.problem_slug for g in gate],
            }
        )
    return out
