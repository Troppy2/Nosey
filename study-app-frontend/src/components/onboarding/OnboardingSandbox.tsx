import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, FolderPlus, Paperclip, Sparkles, X } from "lucide-react";
import {
  SANDBOX_FOLDER_NAME,
  SANDBOX_NOTES,
  SANDBOX_QUESTIONS,
  SANDBOX_STREAM_TITLES,
  type SandboxFrq,
  type SandboxMcq,
} from "./sandboxContent";
import "../../styles/components/onboarding.css";

/*
 * The first-run practice run.
 *
 * The old onboarding was a chain of driver.js popovers pointing at the live UI.
 * Watching people use it, they read none of it: a popover that advances on Next
 * regardless of what you do is indistinguishable from a wall of text, so they
 * pressed Escape and learned nothing.
 *
 * This replaces it with a scale model of Nosey that the user actually drives.
 * Every stage is gated on a real click, choice, or keystroke, so the only way
 * out is through the loop the product is built around: folder, notes, generate,
 * answer, review. Nothing here calls the API, so the rehearsal is identical
 * every time, works for guests, survives a dead LLM provider, and leaves no
 * stray folder or test in a real account.
 */

type Stage = "intro" | "folder" | "notes" | "generate" | "test" | "results" | "done";

const RAIL: { stage: Stage; label: string }[] = [
  { stage: "folder", label: "Folder" },
  { stage: "notes", label: "Notes" },
  { stage: "generate", label: "Generate" },
  { stage: "test", label: "Answer" },
  { stage: "results", label: "Review" },
];

const STAGE_ORDER: Stage[] = ["intro", "folder", "notes", "generate", "test", "results", "done"];

const MCQ = SANDBOX_QUESTIONS[0] as SandboxMcq;
const FRQ = SANDBOX_QUESTIONS[1] as SandboxFrq;

/** Free response needs a real attempt before it can be submitted. */
const FRQ_MIN_CHARS = 25;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Props = {
  /** Called when the user finishes the run or skips out of it. */
  onClose: (outcome: "finished" | "skipped") => void;
  /** Sends the user to the real create-test page. */
  onCreateTest: () => void;
};

export function OnboardingSandbox({ onClose, onCreateTest }: Props) {
  const [stage, setStage] = useState<Stage>("intro");

  // Stage-local state. Each is written by exactly one gate.
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState(SANDBOX_FOLDER_NAME);
  const [folderCreated, setFolderCreated] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachedNoteId, setAttachedNoteId] = useState<string | null>(null);
  const [streamed, setStreamed] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [mcqChoice, setMcqChoice] = useState<number | null>(null);
  const [mcqSubmitted, setMcqSubmitted] = useState(false);
  const [frqText, setFrqText] = useState("");
  const [frqSubmitted, setFrqSubmitted] = useState(false);

  const timersRef = useRef<number[]>([]);

  const attachedNote = useMemo(
    () => SANDBOX_NOTES.find((n) => n.id === attachedNoteId) ?? null,
    [attachedNoteId],
  );

  const advance = useCallback((next: Stage) => setStage(next), []);

  // The page behind the frame must not scroll while the run is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose("skipped");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  // Reveals the generated questions one at a time, the way the real streamed
  // generation does. Reduced motion gets the finished list immediately.
  const runGeneration = useCallback(() => {
    setGenerating(true);
    if (prefersReducedMotion()) {
      setStreamed(SANDBOX_STREAM_TITLES.length);
      setGenerating(false);
      return;
    }
    SANDBOX_STREAM_TITLES.forEach((_, i) => {
      const t = window.setTimeout(() => {
        setStreamed(i + 1);
        if (i === SANDBOX_STREAM_TITLES.length - 1) setGenerating(false);
      }, 600 + i * 520);
      timersRef.current.push(t);
    });
  }, []);

  const railIndex = STAGE_ORDER.indexOf(stage);
  const mcqCorrect = mcqChoice === MCQ.correctIndex;

  return (
    <div className="ob-scrim" role="dialog" aria-modal="true" aria-label="Nosey practice run">
      <div className="ob-frame">
        <header className="ob-head">
          <p className="ob-kicker">Practice run</p>
          <ol className="ob-rail">
            {RAIL.map((seg) => {
              const segIndex = STAGE_ORDER.indexOf(seg.stage);
              const state = segIndex < railIndex ? "done" : segIndex === railIndex ? "current" : "todo";
              return (
                <li key={seg.stage} className={`ob-rail-seg ob-rail-seg--${state}`}>
                  <span className="ob-rail-bar" />
                  <span className="ob-rail-label">{seg.label}</span>
                </li>
              );
            })}
          </ol>
          {stage === "done" ? (
            <span className="ob-skip-spacer" />
          ) : (
            <button type="button" className="ob-skip" onClick={() => onClose("skipped")}>
              Skip
            </button>
          )}
        </header>

        <div className="ob-stage">
          <div className="ob-model">
            {/* ---------------- Intro ---------------- */}
            {stage === "intro" ? (
              <div className="ob-poster">
                <Sparkles size={28} strokeWidth={1.5} />
                <p className="ob-poster-line">
                  Nosey turns the notes you already have into tests you can actually sit.
                </p>
                <p className="ob-poster-sub">
                  You are about to do that once, on a sample set of notes, in about two minutes.
                  Nothing you do here is saved.
                </p>
              </div>
            ) : null}

            {/* ---------------- Folder ---------------- */}
            {stage === "folder" ? (
              <div className="ob-screen">
                <div className="ob-screen-bar">Folders</div>
                <div className="ob-screen-body ob-screen-body--empty">
                  {folderCreated ? (
                    <div className="ob-folder-row">
                      <span className="ob-folder-dot" />
                      <span className="ob-folder-name">{folderName}</span>
                      <span className="ob-folder-meta">0 tests</span>
                    </div>
                  ) : (
                    <>
                      <p className="ob-empty-line">No folders yet.</p>
                      <button
                        type="button"
                        className={`ob-btn ob-btn--primary ${folderModalOpen ? "" : "ob-target"}`}
                        onClick={() => setFolderModalOpen(true)}
                      >
                        <FolderPlus size={16} /> New folder
                      </button>
                    </>
                  )}
                </div>

                {folderModalOpen ? (
                  <div className="ob-mini-modal">
                    <label className="ob-mini-label" htmlFor="ob-folder-name">
                      Folder name
                    </label>
                    <input
                      id="ob-folder-name"
                      className="ob-mini-input"
                      value={folderName}
                      maxLength={40}
                      onChange={(e) => setFolderName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="ob-btn ob-btn--primary ob-target"
                      disabled={folderName.trim().length === 0}
                      onClick={() => {
                        setFolderCreated(true);
                        setFolderModalOpen(false);
                        advance("notes");
                      }}
                    >
                      Create folder
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ---------------- Notes ---------------- */}
            {stage === "notes" ? (
              <div className="ob-screen">
                <div className="ob-screen-bar">{folderName}</div>
                <div className="ob-screen-body">
                  {/* The picker replaces the trigger, the way a real file dialog
                      does, so the pulse only ever sits on one control. */}
                  {pickerOpen ? null : (
                    <button
                      type="button"
                      className="ob-btn ob-btn--quiet ob-target"
                      onClick={() => setPickerOpen(true)}
                    >
                      <Paperclip size={16} /> Add notes
                    </button>
                  )}

                  {pickerOpen ? (
                    <ul className="ob-file-list">
                      {SANDBOX_NOTES.map((note, i) => (
                        <li key={note.id}>
                          <button
                            type="button"
                            className={`ob-file ${i === 0 ? "ob-target" : ""}`}
                            onClick={() => {
                              setAttachedNoteId(note.id);
                              setPickerOpen(false);
                              advance("generate");
                            }}
                          >
                            <FileText size={16} />
                            <span className="ob-file-name">{note.name}</span>
                            <span className="ob-file-meta">{note.meta}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ob-empty-line">Nothing attached yet.</p>
                  )}
                </div>
              </div>
            ) : null}

            {/* ---------------- Generate ---------------- */}
            {stage === "generate" ? (
              <div className="ob-screen">
                <div className="ob-screen-bar">{folderName}</div>
                <div className="ob-screen-body">
                  <div className="ob-attached">
                    <FileText size={16} />
                    <span className="ob-file-name">{attachedNote?.name}</span>
                  </div>
                  <p className="ob-excerpt">{attachedNote?.excerpt}</p>

                  {streamed === 0 && !generating ? (
                    <button
                      type="button"
                      className="ob-btn ob-btn--primary ob-target"
                      onClick={runGeneration}
                    >
                      <Sparkles size={16} /> Generate test
                    </button>
                  ) : (
                    <ol className="ob-stream">
                      {SANDBOX_STREAM_TITLES.slice(0, streamed).map((title, i) => (
                        <li key={title} className="ob-stream-item">
                          <span className="ob-stream-index">{i + 1}</span>
                          {title}
                        </li>
                      ))}
                      {generating ? <li className="ob-stream-pending">Reading your notes...</li> : null}
                    </ol>
                  )}

                  {!generating && streamed > 0 ? (
                    <button
                      type="button"
                      className="ob-btn ob-btn--primary ob-target"
                      onClick={() => advance("test")}
                    >
                      Start test
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* ---------------- Test ---------------- */}
            {stage === "test" ? (
              <div className="ob-screen">
                <div className="ob-screen-bar">
                  {folderName} test, question {questionIndex + 1} of 2
                </div>
                <div className="ob-screen-body">
                  {questionIndex === 0 ? (
                    <>
                      <p className="ob-question">{MCQ.prompt}</p>
                      <ul className="ob-options">
                        {MCQ.options.map((opt, i) => {
                          const chosen = mcqChoice === i;
                          const showKey = mcqSubmitted && i === MCQ.correctIndex;
                          const showWrong = mcqSubmitted && chosen && !mcqCorrect;
                          return (
                            <li key={opt}>
                              <button
                                type="button"
                                className={[
                                  "ob-option",
                                  chosen ? "ob-option--chosen" : "",
                                  showKey ? "ob-option--right" : "",
                                  showWrong ? "ob-option--wrong" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                disabled={mcqSubmitted}
                                onClick={() => setMcqChoice(i)}
                              >
                                <span className="ob-option-mark">{showKey ? <Check size={14} /> : showWrong ? <X size={14} /> : null}</span>
                                {opt}
                              </button>
                            </li>
                          );
                        })}
                      </ul>

                      {mcqSubmitted ? (
                        <>
                          <p className="ob-explain">{MCQ.explanation}</p>
                          <button
                            type="button"
                            className="ob-btn ob-btn--primary ob-target"
                            onClick={() => setQuestionIndex(1)}
                          >
                            Next question
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={`ob-btn ob-btn--primary ${mcqChoice !== null ? "ob-target" : ""}`}
                          disabled={mcqChoice === null}
                          onClick={() => setMcqSubmitted(true)}
                        >
                          Submit answer
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="ob-question">{FRQ.prompt}</p>
                      <textarea
                        className="ob-textarea"
                        rows={4}
                        value={frqText}
                        disabled={frqSubmitted}
                        placeholder="Write a couple of sentences in your own words."
                        onChange={(e) => setFrqText(e.target.value)}
                      />
                      {frqSubmitted ? (
                        <>
                          <p className="ob-explain">{FRQ.feedback}</p>
                          <button
                            type="button"
                            className="ob-btn ob-btn--primary ob-target"
                            onClick={() => advance("results")}
                          >
                            See results
                          </button>
                        </>
                      ) : (
                        <div className="ob-row">
                          <button
                            type="button"
                            className={`ob-btn ob-btn--primary ${frqText.trim().length >= FRQ_MIN_CHARS ? "ob-target" : ""}`}
                            disabled={frqText.trim().length < FRQ_MIN_CHARS}
                            onClick={() => setFrqSubmitted(true)}
                          >
                            Submit answer
                          </button>
                          <button
                            type="button"
                            className="ob-btn ob-btn--ghost"
                            onClick={() => setFrqText(FRQ.sampleAnswer)}
                          >
                            Fill a sample answer
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {/* ---------------- Results ---------------- */}
            {stage === "results" ? (
              <div className="ob-screen">
                <div className="ob-screen-bar">{folderName} test, results</div>
                <div className="ob-screen-body">
                  <p className="ob-score">
                    <strong>{mcqCorrect ? "2" : "1"}</strong> of 2
                  </p>
                  <ul className="ob-recap">
                    <li>
                      <span className={mcqCorrect ? "ob-tick ob-tick--good" : "ob-tick ob-tick--miss"} />
                      Levels of processing
                    </li>
                    <li>
                      <span className="ob-tick ob-tick--good" />
                      Encoding specificity
                    </li>
                  </ul>
                  <p className="ob-explain">
                    Your answers are saved with the attempt, so you can retake this test or come back
                    and read through what you got wrong.
                  </p>
                  <button
                    type="button"
                    className="ob-btn ob-btn--primary ob-target"
                    onClick={() => advance("done")}
                  >
                    Finish
                  </button>
                </div>
              </div>
            ) : null}

            {/* ---------------- Done ---------------- */}
            {stage === "done" ? (
              <div className="ob-poster">
                <Check size={28} strokeWidth={1.5} />
                <p className="ob-poster-line">That is the whole loop.</p>
                <p className="ob-poster-sub">
                  Folder, notes, generate, answer, review. The rest of Nosey hangs off it: the same
                  notes also make flashcards, and Kojo answers questions using the notes in whichever
                  folder you are in.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Announced rather than focused: the coach narrates what just happened,
            but focus belongs on the control the user is about to press. */}
        <footer className="ob-coach" aria-live="polite">
          <h2 className="ob-coach-title">
            {coachTitle(stage, questionIndex, mcqSubmitted, frqSubmitted)}
          </h2>
          <p className="ob-coach-body">
            {coachBody(stage, questionIndex, mcqSubmitted, frqSubmitted, mcqCorrect, generating)}
          </p>

          {stage === "intro" ? (
            <button type="button" className="ob-btn ob-btn--primary" onClick={() => advance("folder")}>
              Start the run
            </button>
          ) : null}

          {stage === "done" ? (
            <div className="ob-row">
              <button
                type="button"
                className="ob-btn ob-btn--primary"
                onClick={() => {
                  onClose("finished");
                  onCreateTest();
                }}
              >
                Make one from my notes
              </button>
              <button type="button" className="ob-btn ob-btn--ghost" onClick={() => onClose("finished")}>
                Look around first
              </button>
            </div>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function coachTitle(stage: Stage, qIndex: number, mcqDone: boolean, frqDone: boolean): string {
  switch (stage) {
    case "intro":
      return "Two minutes, then you are done";
    case "folder":
      return "Everything starts in a folder";
    case "notes":
      return "Feed it what you already have";
    case "generate":
      return "This is the part that does the work";
    case "test":
      if (qIndex === 0) return mcqDone ? "Every answer comes with the reasoning" : "Now sit the test";
      return frqDone ? "Written answers get graded too" : "Free response works the same way";
    case "results":
      return "Results are kept, not thrown away";
    case "done":
      return "You know how to use Nosey now";
  }
}

function coachBody(
  stage: Stage,
  qIndex: number,
  mcqDone: boolean,
  frqDone: boolean,
  mcqCorrect: boolean,
  generating: boolean,
): string {
  switch (stage) {
    case "intro":
      return "You will build a test out of a set of notes and then take it. Press Escape at any point to leave.";
    case "folder":
      return "A folder holds one course: its notes, its tests, its flashcards, and its own chat history. Make one to keep going.";
    case "notes":
      return "Pick a file. Nosey reads PDFs, Word documents, slides, and plain text, and writes questions from what is inside them, not from the internet.";
    case "generate":
      if (generating) return "Questions land one at a time as they are written. On your own notes this takes about a minute.";
      return "Press Generate. Nosey pulls the ideas out of the file and writes a mix of multiple choice and free response.";
    case "test":
      if (qIndex === 0) {
        return mcqDone
          ? mcqCorrect
            ? "Right. Notice you get the reasoning either way, so a lucky guess still teaches you something."
            : "Not this time, and that is the useful case: the correct answer is marked and explained rather than just scored."
          : "Choose the option you think is right, then submit. You cannot change it afterwards, same as the real thing.";
      }
      return frqDone
        ? "That grade came from your notes, not a generic rubric, which is why it can tell you what was missing."
        : "Write a couple of sentences in your own words. Nosey grades it against the notes and writes back feedback on what you said.";
    case "results":
      return "The attempt is kept, so a test is something you come back to rather than a one-off. The same notes can also be turned into flashcards, and the cards you keep getting wrong move up your dashboard.";
    case "done":
      return "Do it once with a file of your own and it will stick.";
  }
}
