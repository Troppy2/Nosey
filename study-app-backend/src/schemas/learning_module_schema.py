from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CreateLearningTrackRequest(BaseModel):
    module_count: int = Field(default=5, ge=1, le=20)
    # article | podcast | lecture. Episode formats ignore module_count and are
    # always built as exactly one module.
    format: str = "article"
    provider: Optional[str] = None
    # Generous ceiling as an abuse/token-cost guard; the UI does not surface it.
    custom_instructions: Optional[str] = Field(default=None, max_length=10000)


class UpdateModuleVideoRequest(BaseModel):
    # http(s) link to attach under the article; null/empty clears it.
    video_url: Optional[str] = Field(default=None, max_length=500)


class UpdateLearningModuleRequest(BaseModel):
    # User-edited lesson markdown; replaces lesson_content wholesale. The
    # narration script and quiz are regenerated from it server-side.
    lesson_content: str = Field(min_length=1, max_length=100000)


class ArchiveTrackRequest(BaseModel):
    # True archives the whole track (frees the folder's active slot); false
    # restores it as the active track (rejected if one already exists).
    archived: bool


class QuizQuestionPublic(BaseModel):
    """A quiz question as sent to the client: no correct_index (graded server-side)."""

    question: str
    options: list[str]


class LearningModuleResponse(BaseModel):
    id: int
    order_index: int
    title: str
    summary: Optional[str] = None
    lesson_content: Optional[str] = None
    # Spoken-word script for TTS; null on modules generated before it existed.
    tts_script: Optional[str] = None
    # User-attached video link shown under the article (display only).
    video_url: Optional[str] = None
    quiz: Optional[list[QuizQuestionPublic]] = None
    best_score: Optional[int] = None
    passed: bool
    # True once both the lesson and quiz have been generated.
    ready: bool
    # True on episode-format modules whose script and checkpoints exist. False
    # on article modules, which never have an episode.
    episode_ready: bool = False


class LearningTrackResponse(BaseModel):
    id: int
    folder_id: int
    status: str
    error: Optional[str] = None
    module_count: int
    # article | podcast | lecture. Echoed so the hub can label each format slot.
    format: str = "article"
    # Echoed back so the UI can show them and a rebuild can reuse them.
    custom_instructions: Optional[str] = None
    # True when the folder's current notes no longer match the notes this track
    # was built from; the UI offers a rebuild.
    notes_stale: bool
    # Archived tracks live under the hub's "Archived" section, viewable but not
    # occupying the folder's active slot.
    is_archived: bool = False
    # ISO timestamp used to label archived tracks in the hub list.
    created_at: Optional[str] = None
    modules: list[LearningModuleResponse]


class QuizAttemptRequest(BaseModel):
    # Selected option index per question, in question order. -1 = unanswered.
    answers: list[int]


class QuizAttemptResponse(BaseModel):
    score: int
    total: int
    passed: bool
    # 0-based correct option index per question, revealed after grading.
    correct_indices: list[int]
    best_score: int


class EpisodeTurn(BaseModel):
    # "host" or "expert" for podcast, "lecturer" for a lecture.
    speaker: str
    text: str


class EpisodeSlide(BaseModel):
    title: str
    bullets: list[str]
    # Optional worked example panel under the bullets.
    example: Optional[str] = None
    # 0-based turn index at which this slide takes the screen.
    start_turn: int


class EpisodeCheckpointPublic(BaseModel):
    """A checkpoint as sent to the client: no correct_index, no explanation.

    Both are withheld until the answer is submitted, because in episode formats
    these checkpoints ARE the graded artifact that marks the module passed.
    """

    after_turn: int
    question: str
    options: list[str]


class EpisodeCheckpointState(BaseModel):
    answer: Optional[int] = None
    correct: bool = False
    # True once answered or skipped, which is what distinguishes a skip from a
    # checkpoint the listener has not reached yet.
    seen: bool = False


class ModuleEpisodeResponse(BaseModel):
    module_id: int
    title: str
    # podcast | lecture, echoed so the player knows which layout to render.
    format: str
    turns: list[EpisodeTurn]
    # Always empty for podcast.
    slides: list[EpisodeSlide]
    checkpoints: list[EpisodeCheckpointPublic]
    progress: list[EpisodeCheckpointState]
    score: int
    total: int
    pass_threshold: int
    passed: bool


class CheckpointAnswerRequest(BaseModel):
    checkpoint_index: int
    # Chosen option index; -1 means skipped, which scores as wrong.
    answer: int


class CheckpointAnswerResponse(BaseModel):
    correct: bool
    correct_index: int
    explanation: str
    score: int
    total: int
    passed: bool
    # True once every checkpoint has been answered or skipped.
    complete: bool
    best_score: int
