from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

# The backend owns no System Design content: the concepts are bundled with the
# frontend. These ids are therefore opaque strings whose SHAPE is validated and
# whose existence is not.
CONCEPT_ID_PATTERN = re.compile(r"^[a-z0-9-]{1,80}$")
EXERCISE_ID_PATTERN = re.compile(r"^[a-z0-9-]{1,80}:(visualizer|project)$")

# Every sub-module of a concept, in display order. All five must be done for the
# concept to count as complete.
SUB_MODULES: tuple[str, ...] = ("notes", "video", "visualizer", "project", "quiz")
# The only two a client may assert directly. visualizer and project are earned by
# a passing Pyodide run, quiz by a graded attempt, so they have their own routes.
CLIENT_SUB_MODULES: frozenset[str] = frozenset({"notes", "video"})

# Autosave guards. A workspace is a handful of small Python files; anything past
# these is a client bug or an abuse attempt, not a learner.
MAX_FILES_PER_SUBMISSION = 20
MAX_FILE_NAME_LENGTH = 120
MAX_SUBMISSION_BYTES = 200_000


class _CamelModel(BaseModel):
    """Frontend-facing JSON is camelCase; the Python attributes stay snake_case."""

    model_config = ConfigDict(populate_by_name=True)


class SDProgressDTO(_CamelModel):
    notes_done: bool = Field(default=False, alias="notesDone")
    video_done: bool = Field(default=False, alias="videoDone")
    visualizer_done: bool = Field(default=False, alias="visualizerDone")
    project_done: bool = Field(default=False, alias="projectDone")
    quiz_done: bool = Field(default=False, alias="quizDone")
    quiz_best_score: Optional[int] = Field(default=None, alias="quizBestScore")
    completed_at: Optional[datetime] = Field(default=None, alias="completedAt")


class SDProgressResponse(_CamelModel):
    concepts: dict[str, SDProgressDTO] = Field(default_factory=dict)


class SDSubModuleRequest(_CamelModel):
    sub_module: str = Field(..., alias="subModule", max_length=40)
    done: bool


class SDSubmissionResponse(_CamelModel):
    files: dict[str, str] = Field(default_factory=dict)
    last_run_passed: bool = Field(default=False, alias="lastRunPassed")
    passed_at: Optional[datetime] = Field(default=None, alias="passedAt")


class SDSubmissionSaveRequest(_CamelModel):
    files: dict[str, str] = Field(default_factory=dict)
    ran_passed: bool = Field(default=False, alias="ranPassed")


# ── quiz grading (implemented in PR 6) ────────────────────────────────────────


class SDMcqResult(_CamelModel):
    id: str = Field(..., max_length=80)
    chosen_index: int = Field(..., alias="chosenIndex", ge=-1, le=3)
    correct_index: int = Field(..., alias="correctIndex", ge=0, le=3)


class SDFrqSubmission(_CamelModel):
    id: str = Field(..., max_length=80)
    prompt: str = Field(..., max_length=4000)
    rubric: str = Field(..., max_length=4000)
    answer: str = Field(default="", max_length=8000)


class SDQuizGradeRequest(_CamelModel):
    notes: str = Field(default="", max_length=60000)
    mcq: list[SDMcqResult] = Field(default_factory=list)
    frq: list[SDFrqSubmission] = Field(default_factory=list)


class SDFrqFeedback(_CamelModel):
    id: str
    is_correct: bool = Field(alias="isCorrect")
    feedback: str = ""
    confidence: float = 0.0
    flagged_uncertain: bool = Field(default=False, alias="flaggedUncertain")


class SDQuizGradeResponse(_CamelModel):
    mcq_score: int = Field(alias="mcqScore")
    frq_score: int = Field(alias="frqScore")
    total_score: int = Field(alias="totalScore")
    passed: bool
    grader_degraded: bool = Field(default=False, alias="graderDegraded")
    frq_feedback: list[SDFrqFeedback] = Field(default_factory=list, alias="frqFeedback")
    concept_completed: bool = Field(default=False, alias="conceptCompleted")
