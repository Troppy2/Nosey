import { ArrowLeft, Check, Pause, Play, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { MarkdownContent } from "../components/MarkdownContent";
import { markdownToSpeech, speechCapability, splitForSpeech } from "../components/episodeSpeech";
import { getConcept } from "../data/systemDesign";
import {
  getSystemDesignProgress,
  gradeSystemDesignQuiz,
  markSystemDesignSubModule,
} from "../lib/api";
import { useSettings } from "../lib/useSettings";
import type {
  SystemDesignClientSubModule,
  SystemDesignProgressEntry,
  SystemDesignQuizResult,
} from "../lib/types";
import { SD_EMPTY_PROGRESS, SD_SUB_MODULES, doneCount, isSubModuleDone } from "./SystemDesign";

/** Written answers this short are not an attempt at the question. */
const MIN_FRQ_CHARS = 40;

/**
 * Notes are authored as standalone articles, so they open with their own title.
 * The page already shows that title in its header, so the first heading is
 * dropped rather than printed twice.
 */
export function stripLeadingHeading(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]*\n+/, "");
}

/** Play/pause/stop over the Web Speech API, one chunk at a time.
 *  Chrome silently drops long utterances, hence splitForSpeech. */
function useReadAloud(markdown: string) {
  const capability = useMemo(() => speechCapability(), []);
  const chunks = useMemo(() => splitForSpeech(markdownToSpeech(markdown)), [markdown]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const indexRef = useRef(0);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    indexRef.current = 0;
    setSpeaking(false);
    setPaused(false);
  }, []);

  useEffect(() => stop, [stop]);

  const speakFrom = useCallback(
    (start: number) => {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      indexRef.current = start;
      for (let i = start; i < chunks.length; i += 1) {
        const utterance = new SpeechSynthesisUtterance(chunks[i]);
        utterance.onstart = () => {
          indexRef.current = i;
        };
        if (i === chunks.length - 1) {
          // Deliberately does NOT mark the notes read. Completion is the
          // learner's explicit claim, never something audio playback asserts.
          utterance.onend = () => {
            setSpeaking(false);
            setPaused(false);
            indexRef.current = 0;
          };
        }
        synth.speak(utterance);
      }
      setSpeaking(true);
      setPaused(false);
    },
    [chunks],
  );

  const toggle = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (!speaking) {
      speakFrom(0);
      return;
    }
    if (paused) {
      synth.resume();
      setPaused(false);
    } else {
      synth.pause();
      setPaused(true);
    }
  }, [paused, speakFrom, speaking]);

  const skip = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(indexRef.current + delta, 0), Math.max(chunks.length - 1, 0));
      speakFrom(next);
    },
    [chunks.length, speakFrom],
  );

  return { capability, chunks, speaking, paused, toggle, stop, skip };
}

export default function SystemDesignConcept() {
  const { conceptId } = useParams<{ conceptId: string }>();
  const { betaMode } = useSettings();
  const concept = getConcept(conceptId);

  const [entry, setEntry] = useState<SystemDesignProgressEntry>(SD_EMPTY_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SystemDesignClientSubModule | null>(null);

  const [quizOpen, setQuizOpen] = useState(false);
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, number>>({});
  const [frqAnswers, setFrqAnswers] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState(false);
  const [quizValidation, setQuizValidation] = useState<string | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<SystemDesignQuizResult | null>(null);

  const refreshProgress = useCallback(async () => {
    if (!conceptId) return;
    try {
      const result = await getSystemDesignProgress();
      setEntry(result.concepts?.[conceptId] ?? SD_EMPTY_PROGRESS);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load your progress.");
    }
  }, [conceptId]);

  useEffect(() => {
    if (!concept || !betaMode) return;
    void refreshProgress();
  }, [betaMode, concept, refreshProgress]);

  const readAloud = useReadAloud(concept?.notes ?? "");

  const mark = useCallback(
    async (subModule: SystemDesignClientSubModule, done: boolean) => {
      if (!concept) return;
      setSaving(subModule);
      setError(null);
      // Optimistic: the checkmark is the whole point of the interaction, and a
      // failure puts it back and says why.
      const previous = entry;
      setEntry({ ...entry, [`${subModule}Done`]: done });
      try {
        await markSystemDesignSubModule(concept.id, subModule, done);
        await refreshProgress();
      } catch (err: unknown) {
        setEntry(previous);
        setError(err instanceof Error ? err.message : "Could not save that change.");
      } finally {
        setSaving(null);
      }
    },
    [concept, entry, refreshProgress],
  );

  const submitQuiz = useCallback(async () => {
    if (!concept) return;
    const unanswered = concept.quiz.mcq.filter((question) => mcqAnswers[question.id] === undefined);
    const tooShort = concept.quiz.frq.filter(
      (question) => (frqAnswers[question.id] ?? "").trim().length < MIN_FRQ_CHARS,
    );
    if (unanswered.length || tooShort.length) {
      setQuizValidation(
        [
          unanswered.length
            ? `Answer all ${concept.quiz.mcq.length} multiple choice questions.`
            : "",
          tooShort.length
            ? `${tooShort.length} written answer${tooShort.length === 1 ? "" : "s"} still need at least ${MIN_FRQ_CHARS} characters.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      return;
    }

    setQuizValidation(null);
    setQuizError(null);
    setQuizResult(null);
    setGrading(true);
    try {
      const result = await gradeSystemDesignQuiz(concept.id, {
        notes: concept.notes,
        mcq: concept.quiz.mcq.map((question) => ({
          id: question.id,
          chosenIndex: mcqAnswers[question.id],
          correctIndex: question.correctIndex,
        })),
        frq: concept.quiz.frq.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          rubric: question.rubric,
          answer: frqAnswers[question.id] ?? "",
        })),
      });
      setQuizResult(result);
      // The server already flipped quiz_done when the attempt passed, so the
      // chips come from a refetch rather than from guessing here.
      await refreshProgress();
    } catch (err: unknown) {
      setQuizError(
        err instanceof Error
          ? err.message
          : "Grading is temporarily unavailable, try again shortly.",
      );
    } finally {
      setGrading(false);
    }
  }, [concept, frqAnswers, mcqAnswers, refreshProgress]);

  if (!betaMode) return <Navigate to="/leetcode" replace />;
  if (!concept) return <Navigate to="/system-design" replace />;

  const complete = doneCount(entry) === SD_SUB_MODULES.length;

  return (
    <div className="page page-narrow sd-page">
      <header className="page-header mode-header">
        <Link
          className="flash-back-btn"
          to="/system-design"
          aria-label="Back to all concepts"
          title="Back to all concepts"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="sd-header-main">
          <span className="eyebrow">System Design</span>
          <h1>{concept.title}</h1>
          <p className="muted sd-lede">{concept.blurb}</p>
        </div>
      </header>

      {/* Links, not decoration: the page is long, and this is the fastest way to
          the sub-module you came back for. */}
      <nav className="sd-chips sd-chips--nav" aria-label="Sub-modules">
        {SD_SUB_MODULES.map((subModule) => {
          const Icon = subModule.icon;
          const isDone = isSubModuleDone(entry, subModule.key);
          return (
            <a
              key={subModule.key}
              href={`#sd-panel-${subModule.key}`}
              className={`sd-chip${isDone ? " is-done" : ""}`}
              data-testid={`sd-chip-${subModule.key}`}
              data-sub-module={subModule.key}
              data-done={isDone ? "true" : "false"}
            >
              {isDone ? <Check size={14} /> : <Icon size={14} />}
              {subModule.label}
            </a>
          );
        })}
        <span className="sd-chips-count">
          {doneCount(entry)} of {SD_SUB_MODULES.length} done
        </span>
      </nav>

      {complete ? (
        <div className="sd-banner sd-banner--done" data-testid="sd-concept-complete" role="status">
          All five sub-modules done. {concept.title} is complete.
        </div>
      ) : null}

      {error ? (
        <div className="sd-banner sd-banner--warn" role="status">
          {error}
        </div>
      ) : null}

      <section className="sd-panel" id="sd-panel-notes">
        <header className="sd-panel-head">
          <h2>Notes</h2>
          {readAloud.capability.usable ? (
            <div className="sd-audio-controls">
              <button type="button" className="sd-audio-btn" onClick={readAloud.toggle}>
                {readAloud.speaking && !readAloud.paused ? <Pause size={14} /> : <Play size={14} />}
                {readAloud.speaking && !readAloud.paused ? "Pause" : "Read aloud"}
              </button>
              {/* Transport appears only once there is something to move through,
                  rather than three greyed-out buttons sitting there at rest. */}
              {readAloud.speaking ? (
                <>
                  <button type="button" className="sd-audio-btn" onClick={() => readAloud.skip(-1)}>
                    Back
                  </button>
                  <button type="button" className="sd-audio-btn" onClick={() => readAloud.skip(1)}>
                    Forward
                  </button>
                  <button type="button" className="sd-audio-btn" onClick={readAloud.stop}>
                    <Square size={14} />
                    Stop
                  </button>
                </>
              ) : null}
            </div>
          ) : (
            <span className="small muted">
              {readAloud.capability.reason ?? "Read-aloud is unavailable in this browser."}
            </span>
          )}
        </header>

        <div className="sd-notes">
          <MarkdownContent content={stripLeadingHeading(concept.notes)} enableCodeCopy />
        </div>

        <div className="sd-panel-foot">
          {entry.notesDone ? (
            <>
              <span className="sd-done-flag">
                <Check size={16} />
                Marked as read
              </span>
              <button
                type="button"
                className="sd-audio-btn"
                onClick={() => void mark("notes", false)}
                disabled={saving === "notes"}
              >
                Undo
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={() => void mark("notes", true)}
              disabled={saving === "notes"}
            >
              Mark as read
            </button>
          )}
        </div>
      </section>

      <section className="sd-panel" id="sd-panel-video">
        <header className="sd-panel-head">
          <h2>Video</h2>
        </header>
        {concept.video ? (
          <div className="sd-video">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${concept.video.youtubeId}`}
              title={concept.video.title}
              allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="muted">
            No video is bundled with this concept yet. Watch one you trust elsewhere, then tick the
            box to record it.
          </p>
        )}
        <label className="sd-checkbox">
          <input
            type="checkbox"
            className="checkbox-input"
            checked={entry.videoDone}
            disabled={saving === "video"}
            onChange={(event) => void mark("video", event.target.checked)}
          />
          I watched this
        </label>
      </section>

      <div className="sd-exercise-grid">
        <section className="sd-panel" id="sd-panel-visualizer">
          <header className="sd-panel-head">
            <h2>Visualizer</h2>
            {entry.visualizerDone ? (
              <span className="sd-done-flag">
                <Check size={16} />
                Passed
              </span>
            ) : null}
          </header>
          <p className="sd-exercise-title">{concept.visualizer.title}</p>
          <p className="muted small">
            Build it from scratch and watch your own instrumentation replay on the timeline.
          </p>
          <Link
            to={`/system-design/${concept.id}/visualizer`}
            className="button button-primary sd-panel-cta"
            data-testid="sd-open-visualizer"
          >
            {entry.visualizerDone ? "Open again" : "Open"}
          </Link>
        </section>

        <section className="sd-panel" id="sd-panel-project">
          <header className="sd-panel-head">
            <h2>Project</h2>
            {entry.projectDone ? (
              <span className="sd-done-flag">
                <Check size={16} />
                Passed
              </span>
            ) : null}
          </header>
          <p className="sd-exercise-title">{concept.project.title}</p>
          <p className="muted small">
            A longer build against a provided backing store, with a real test suite.
          </p>
          <Link
            to={`/system-design/${concept.id}/project`}
            className="button button-primary sd-panel-cta"
            data-testid="sd-open-project"
          >
            {entry.projectDone ? "Open again" : "Open"}
          </Link>
        </section>
      </div>

      <section className="sd-panel" id="sd-panel-quiz">
        <header className="sd-panel-head">
          <h2>Quiz</h2>
          <div className="sd-panel-head-meta">
            {entry.quizDone ? (
              <span className="sd-done-flag">
                <Check size={16} />
                Passed
              </span>
            ) : null}
            {entry.quizBestScore !== null ? (
              <span className="pill">Best {entry.quizBestScore}%</span>
            ) : null}
          </div>
        </header>

        {!quizOpen ? (
          <>
            <p className="muted small">
              {concept.quiz.mcq.length} multiple choice questions, then {concept.quiz.frq.length}{" "}
              written answers graded against these notes. You need 80% on the multiple choice and
              60% on the written answers to pass.
            </p>
            <button
              type="button"
              className="button button-primary sd-panel-cta"
              data-testid="sd-start-quiz"
              onClick={() => setQuizOpen(true)}
            >
              {entry.quizDone ? "Take it again" : "Start quiz"}
            </button>
          </>
        ) : (
          <div className="sd-quiz" data-testid="sd-quiz">
            <h3 className="sd-quiz-section">
              Multiple choice
              <span className="muted small"> ({concept.quiz.mcq.length} questions)</span>
            </h3>
            <ol className="sd-quiz-list">
              {concept.quiz.mcq.map((question, questionIndex) => (
                <li key={question.id} className="sd-quiz-question">
                  <p className="sd-quiz-prompt">
                    <span className="sd-quiz-number">{questionIndex + 1}</span>
                    {question.prompt}
                  </p>
                  <ul className="sd-quiz-options">
                    {question.options.map((option, index) => (
                      <li key={option}>
                        <label
                          className={`sd-quiz-option${mcqAnswers[question.id] === index ? " is-chosen" : ""}`}
                        >
                          <input
                            type="radio"
                            name={question.id}
                            data-testid={`sd-mcq-${question.id}-${index}`}
                            checked={mcqAnswers[question.id] === index}
                            onChange={() =>
                              setMcqAnswers((previous) => ({ ...previous, [question.id]: index }))
                            }
                          />
                          {option}
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>

            <h3 className="sd-quiz-section">
              Written answers
              <span className="muted small"> ({concept.quiz.frq.length} questions)</span>
            </h3>
            <ol className="sd-quiz-list">
              {concept.quiz.frq.map((question, questionIndex) => {
                const answer = frqAnswers[question.id] ?? "";
                const length = answer.trim().length;
                const short = length < MIN_FRQ_CHARS;
                return (
                  <li key={question.id} className="sd-quiz-question">
                    <p className="sd-quiz-prompt">
                      <span className="sd-quiz-number">{questionIndex + 1}</span>
                      {question.prompt}
                    </p>
                    <textarea
                      className="sd-quiz-textarea"
                      rows={5}
                      placeholder="Answer in a few sentences."
                      data-testid={`sd-frq-${question.id}`}
                      value={answer}
                      onChange={(event) =>
                        setFrqAnswers((previous) => ({
                          ...previous,
                          [question.id]: event.target.value,
                        }))
                      }
                    />
                    {/* Silent on an untouched box: five "40 more characters
                        needed" lines on arrival read as five errors. */}
                    {length > 0 ? (
                      <span className={`sd-quiz-counter${short ? "" : " is-met"}`}>
                        {short ? `${MIN_FRQ_CHARS - length} more characters needed` : "Long enough"}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {quizValidation ? (
              <div
                className="sd-banner sd-banner--warn"
                data-testid="sd-quiz-validation"
                role="status"
              >
                {quizValidation}
              </div>
            ) : null}

            {quizError ? (
              <div className="sd-banner sd-banner--warn" data-testid="sd-quiz-error" role="status">
                {quizError} Your answers are still here, so you can submit again.
              </div>
            ) : null}

            {grading ? (
              <div className="sd-quiz-grading" data-testid="sd-quiz-grading" role="status">
                Grading your {concept.quiz.frq.length} written answers. This usually takes five to
                fifteen seconds.
              </div>
            ) : null}

            <div className="button-row sd-quiz-actions">
              <button
                type="button"
                className="button button-primary"
                data-testid="sd-quiz-submit"
                onClick={() => void submitQuiz()}
                disabled={grading}
              >
                Submit quiz
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setQuizOpen(false);
                  setQuizValidation(null);
                  setQuizError(null);
                }}
                disabled={grading}
              >
                Close quiz
              </button>
            </div>

            {quizResult ? (
              <div className="sd-quiz-result" data-testid="sd-quiz-result">
                <div className="sd-quiz-scores">
                  <span className="pill">Multiple choice {quizResult.mcqScore}%</span>
                  <span className="pill">Written {quizResult.frqScore}%</span>
                  <span className="pill">Total {quizResult.totalScore}%</span>
                </div>

                {quizResult.graderDegraded ? (
                  <div
                    className="sd-banner sd-banner--warn"
                    data-testid="sd-quiz-degraded"
                    role="status"
                  >
                    The grader could not read your answers this time. This is not a fail, submit
                    again in a moment.
                  </div>
                ) : quizResult.passed ? (
                  <div
                    className="sd-banner sd-banner--done"
                    data-testid="sd-quiz-passed"
                    role="status"
                  >
                    Passed. The quiz sub-module is marked done.
                  </div>
                ) : (
                  <div
                    className="sd-banner sd-banner--warn"
                    data-testid="sd-quiz-failed"
                    role="status"
                  >
                    Not passed yet. Read the feedback below and try again.
                  </div>
                )}

                {quizResult.conceptCompleted ? (
                  <div
                    className="sd-banner sd-banner--done"
                    data-testid="sd-quiz-celebration"
                    role="status"
                  >
                    That was the last sub-module. {concept.title} is complete.
                  </div>
                ) : null}

                <ul className="sd-quiz-feedback">
                  {quizResult.frqFeedback.map((item) => {
                    const question = concept.quiz.frq.find((candidate) => candidate.id === item.id);
                    return (
                      <li
                        key={item.id}
                        className={`sd-quiz-feedback-item${item.isCorrect ? " is-pass" : " is-fail"}`}
                      >
                        <p className="sd-quiz-prompt">{question?.prompt ?? item.id}</p>
                        <p>{item.feedback}</p>
                        {item.flaggedUncertain ? (
                          <span className="small muted">The grader was unsure about this one.</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
