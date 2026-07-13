import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { MarkdownContent } from "../components/MarkdownContent";
import { SkeletonText } from "../components/Skeletons";
import { fetchLearningTrack, scopeKey, submitModuleQuiz } from "../lib/api";
import { useSettings } from "../lib/useSettings";
import type { LearningTrack, QuizAttemptResult } from "../lib/types";

// Converts a markdown lesson into plain sentences the Web Speech API can read
// without announcing syntax. Code blocks and equations are summarized rather
// than read symbol by symbol.
function markdownToSpeech(markdown: string): string {
  let text = markdown;
  text = text.replace(/```[\s\S]*?```/g, " Here, see the code example on screen. ");
  text = text.replace(/\$\$[\s\S]*?\$\$/g, " See the equation on screen. ");
  text = text.replace(/\$[^$\n]+\$/g, " (see the expression on screen) ");
  text = text.replace(/^#{1,6}\s*/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/^[-*+]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  text = text.replace(/\|/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

// Splits a markdown lesson into paragraph-level blocks (keeping fenced code
// blocks intact) so each block can be rendered separately and highlighted
// while the TTS reads it.
function splitLessonBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

// Chrome silently stops long utterances, so the lesson is split into short
// chunks that are queued one after another.
function splitForSpeech(text: string, maxLen = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

type SpeechState = "idle" | "playing" | "paused";

export default function LearningModuleLesson() {
  const { folderId, moduleId } = useParams();
  const numericFolderId = folderId ? Number(folderId) : null;
  const numericModuleId = moduleId ? Number(moduleId) : null;
  const { betaMode } = useSettings();

  const [track, setTrack] = useState<LearningTrack | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── TTS ────────────────────────────────────────────────────────────────────
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speech, setSpeech] = useState<SpeechState>("idle");
  const [rate, setRate] = useState(1);
  // The current reading position (paragraph block). Highlighted on screen,
  // moved by the TTS as it reads, steppable with prev/next, and persisted to
  // localStorage per module so the reader resumes where they left off.
  const [cursorBlock, setCursorBlock] = useState(0);
  const chunkIndexRef = useRef(0);
  const chunksRef = useRef<{ blockIndex: number; text: string }[]>([]);
  const stoppedRef = useRef(false);
  const rateRef = useRef(1);

  const cursorKey = numericModuleId != null ? scopeKey(`nosey_lm_block_${numericModuleId}`) : "";

  useEffect(() => {
    if (numericFolderId == null) return;
    fetchLearningTrack(numericFolderId)
      .then(setTrack)
      .catch(() => setTrack(null))
      .finally(() => setLoaded(true));
  }, [numericFolderId]);

  const module = useMemo(
    () => track?.modules.find((m) => m.id === numericModuleId) ?? null,
    [track, numericModuleId],
  );
  const moduleIndex = useMemo(
    () => (track && module ? track.modules.findIndex((m) => m.id === module.id) : -1),
    [track, module],
  );
  const nextModule =
    track && moduleIndex >= 0 && moduleIndex + 1 < track.modules.length
      ? track.modules[moduleIndex + 1]
      : null;

  const lessonBlocks = useMemo(
    () => (module?.lesson_content ? splitLessonBlocks(module.lesson_content) : []),
    [module?.lesson_content],
  );

  // What the voice actually reads, one entry per on-screen block. Modules
  // generated with a tts_script get the LLM-written narration (math and code
  // described in words); its paragraphs mirror the lesson blocks, so they map
  // 1:1 when the counts line up and proportionally when they drift. Older
  // modules fall back to stripping the lesson markdown. markdownToSpeech runs
  // on script paragraphs too as a safety net against stray markdown/LaTeX.
  const speechBlocks = useMemo(() => {
    if (module?.tts_script && lessonBlocks.length > 0) {
      const paragraphs = module.tts_script
        .split(/\n\s*\n/)
        .map((p) => markdownToSpeech(p))
        .filter(Boolean);
      const lastBlock = lessonBlocks.length - 1;
      return paragraphs.map((text, i) => ({
        blockIndex:
          paragraphs.length === lessonBlocks.length
            ? i
            : Math.min(lastBlock, Math.round((i * lastBlock) / Math.max(1, paragraphs.length - 1))),
        text,
      }));
    }
    return lessonBlocks
      .map((block, blockIndex) => ({ blockIndex, text: markdownToSpeech(block) }))
      .filter((b) => b.text);
  }, [module?.tts_script, lessonBlocks]);

  // The key is kept in a ref so the stable speech callbacks can persist the
  // cursor without being recreated per module.
  const cursorKeyRef = useRef(cursorKey);
  cursorKeyRef.current = cursorKey;

  // Moves the reading position AND saves it (position 0 = "start", not stored).
  const updateCursor = useCallback((index: number) => {
    setCursorBlock(index);
    const key = cursorKeyRef.current;
    if (!key) return;
    if (index > 0) {
      localStorage.setItem(key, String(index));
    } else {
      localStorage.removeItem(key);
    }
  }, []);

  // Restore the saved reading position whenever the module's blocks load.
  useEffect(() => {
    if (lessonBlocks.length === 0) return;
    const saved = cursorKey ? Number(localStorage.getItem(cursorKey) ?? "0") : 0;
    const clamped =
      Number.isFinite(saved) && saved > 0 ? Math.min(saved, lessonBlocks.length - 1) : 0;
    setCursorBlock(clamped);
  }, [cursorKey, lessonBlocks.length]);

  const speakChunk = useCallback(() => {
    if (stoppedRef.current) return;
    const chunk = chunksRef.current[chunkIndexRef.current];
    if (!chunk) {
      // Natural end of the lesson: reading position resets to the top.
      setSpeech("idle");
      updateCursor(0);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    utterance.rate = rateRef.current;
    utterance.onstart = () => updateCursor(chunk.blockIndex);
    utterance.onend = () => {
      chunkIndexRef.current += 1;
      speakChunk();
    };
    utterance.onerror = () => setSpeech("idle");
    window.speechSynthesis.speak(utterance);
  }, [updateCursor]);

  // Builds the chunk queue and starts speaking from the given block. Chunks are
  // tagged with their source block so the reader can follow the highlight.
  const startSpeechFrom = useCallback(
    (fromBlock: number) => {
      if (!ttsSupported || speechBlocks.length === 0) return;
      window.speechSynthesis.cancel();
      stoppedRef.current = false;
      chunksRef.current = speechBlocks.flatMap((block) => {
        if (block.blockIndex < fromBlock) return [];
        return splitForSpeech(block.text).map((text) => ({ blockIndex: block.blockIndex, text }));
      });
      chunkIndexRef.current = 0;
      setSpeech("playing");
      speakChunk();
    },
    [ttsSupported, speechBlocks, speakChunk],
  );

  function startSpeech() {
    // "Listen" picks up from the saved/stepped reading position.
    startSpeechFrom(cursorBlock);
  }

  function pauseSpeech() {
    window.speechSynthesis.pause();
    setSpeech("paused");
  }

  function resumeSpeech() {
    window.speechSynthesis.resume();
    setSpeech("playing");
  }

  const stopSpeech = useCallback(() => {
    stoppedRef.current = true;
    window.speechSynthesis.cancel();
    setSpeech("idle");
  }, []);

  // Step the reading position to a specific block. While playing, the voice
  // jumps there and keeps reading; otherwise only the highlight moves and
  // "Listen" will start from it.
  function jumpToBlock(target: number) {
    const clamped = Math.min(Math.max(target, 0), lessonBlocks.length - 1);
    if (speech === "playing") {
      startSpeechFrom(clamped);
    } else {
      if (speech === "paused") {
        // A paused queue can't be retargeted; drop it and let Listen restart.
        stoppedRef.current = true;
        window.speechSynthesis.cancel();
        setSpeech("idle");
      }
      updateCursor(clamped);
    }
  }

  // Keep the current block in view: while listening it follows the voice, and
  // on load it brings the reader back to where they left off.
  useEffect(() => {
    if (cursorBlock === 0 && speech === "idle") return;
    const el = document.getElementById(`lm-lesson-block-${cursorBlock}`);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }, [cursorBlock, speech]);

  function changeRate(newRate: number) {
    setRate(newRate);
    rateRef.current = newRate;
    // A rate change applies from the next chunk; restart the current chunk so
    // it takes effect immediately.
    if (speech === "playing") {
      window.speechSynthesis.cancel();
      speakChunk();
    }
  }

  // Stop reading when leaving the page OR switching to another module (the
  // component stays mounted when only the :moduleId param changes). The restore
  // effect above re-derives the new module's saved position.
  useEffect(() => {
    return () => {
      if (ttsSupported) {
        stoppedRef.current = true;
        window.speechSynthesis.cancel();
        setSpeech("idle");
      }
    };
  }, [ttsSupported, numericModuleId]);

  async function handleSubmitQuiz() {
    if (!module?.quiz || submitting) return;
    const answerList = module.quiz.map((_, i) => answers[i] ?? -1);
    setSubmitting(true);
    setError(null);
    try {
      const graded = await submitModuleQuiz(module.id, answerList);
      setResult(graded);
      // Reflect the pass locally so "Next module" unlocks without a refetch.
      if (graded.passed && track && module) {
        setTrack({
          ...track,
          modules: track.modules.map((m) =>
            m.id === module.id ? { ...m, passed: true, best_score: graded.best_score } : m,
          ),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grade the quiz. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function retryQuiz() {
    setAnswers({});
    setResult(null);
    setError(null);
  }

  if (numericFolderId == null || numericModuleId == null) return <Navigate to="/flashcards" replace />;
  if (!betaMode) return <Navigate to={`/flashcards/${numericFolderId}`} replace />;

  if (!loaded) {
    return (
      <div className="page page-narrow">
        <SkeletonText lines={7} label="Loading the lesson" />
      </div>
    );
  }

  if (!module || !module.lesson_content) {
    return (
      <div className="page page-narrow">
        <Card className="lm-failed">
          <div>
            <strong>This module is not ready yet.</strong>
            <p className="muted small">It may still be generating, or the track was rebuilt.</p>
          </div>
          <Link to={`/flashcards/${numericFolderId}/modules`}>
            <Button variant="secondary">Back to track</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const quiz = module.quiz ?? [];
  const allAnswered = quiz.length > 0 && quiz.every((_, i) => answers[i] != null);

  return (
    <div className="page page-narrow lm-lesson-page">
      <header className="page-header mode-header">
        <Link
          className="flash-back-btn"
          to={`/flashcards/${numericFolderId}/modules`}
          aria-label="Back to track"
          title="Back to track"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <span className="eyebrow">
            Module {moduleIndex + 1} of {track?.modules.length ?? "?"}
          </span>
          <h1>{module.title}</h1>
          {module.summary ? <p className="muted">{module.summary}</p> : null}
        </div>
      </header>

      {ttsSupported ? (
        <div className="lm-tts-bar" role="group" aria-label="Read lesson aloud">
          {speech === "idle" ? (
            <button className="lm-tts-btn lm-tts-btn--main" type="button" onClick={startSpeech}>
              <Play size={16} /> {cursorBlock > 0 ? "Resume" : "Listen"}
            </button>
          ) : speech === "playing" ? (
            <button className="lm-tts-btn lm-tts-btn--main" type="button" onClick={pauseSpeech}>
              <Pause size={16} /> Pause
            </button>
          ) : (
            <button className="lm-tts-btn lm-tts-btn--main" type="button" onClick={resumeSpeech}>
              <Play size={16} /> Resume
            </button>
          )}
          {speech !== "idle" ? (
            <button className="lm-tts-btn" type="button" onClick={stopSpeech} aria-label="Stop reading">
              <Square size={14} /> Stop
            </button>
          ) : null}
          {speech === "idle" && cursorBlock > 0 ? (
            <button
              className="lm-tts-btn"
              type="button"
              onClick={() => jumpToBlock(0)}
              aria-label="Start over from the first paragraph"
              title="Start over from the first paragraph"
            >
              <RotateCcw size={14} /> Start over
            </button>
          ) : null}
          <div className="lm-tts-steps" role="group" aria-label="Move between paragraphs">
            <button
              className="lm-tts-btn lm-tts-btn--step"
              type="button"
              onClick={() => jumpToBlock(cursorBlock - 1)}
              disabled={cursorBlock <= 0}
              aria-label="Previous paragraph"
              title="Previous paragraph"
            >
              <SkipBack size={14} />
            </button>
            <span className="lm-tts-pos" aria-live="polite">
              {cursorBlock + 1} / {lessonBlocks.length}
            </span>
            <button
              className="lm-tts-btn lm-tts-btn--step"
              type="button"
              onClick={() => jumpToBlock(cursorBlock + 1)}
              disabled={cursorBlock >= lessonBlocks.length - 1}
              aria-label="Next paragraph"
              title="Next paragraph"
            >
              <SkipForward size={14} />
            </button>
          </div>
          <div className="lm-tts-rates" aria-label="Reading speed">
            {[0.75, 1, 1.25, 1.5].map((option) => (
              <button
                key={option}
                type="button"
                className={`lm-tts-rate ${rate === option ? "is-active" : ""}`}
                onClick={() => changeRate(option)}
              >
                {option}x
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Card className="lm-lesson-card">
        {lessonBlocks.map((block, index) => {
          // The current block shows the full "speaking" highlight while the
          // voice is on it, and a quieter position marker when idle/paused.
          const isCurrent = cursorBlock === index;
          const stateClass = isCurrent
            ? speech === "playing"
              ? "is-speaking"
              : cursorBlock > 0 || speech !== "idle"
                ? "is-cursor"
                : ""
            : "";
          return (
            <div key={index} id={`lm-lesson-block-${index}`} className={`lm-lesson-block ${stateClass}`}>
              <MarkdownContent content={block} />
            </div>
          );
        })}
      </Card>

      <section className="lm-quiz">
        <h2 className="lm-quiz-title">Check your understanding</h2>
        <p className="muted small">
          {quiz.length} questions. Score {Math.ceil(quiz.length * 0.8)} or better to unlock the next
          module.
        </p>

        {quiz.map((question, qIndex) => {
          const chosen = answers[qIndex];
          const correctIndex = result?.correct_indices[qIndex];
          return (
            <Card key={qIndex} className="lm-quiz-question">
              <div className="lm-quiz-q-text">
                <span className="lm-quiz-q-num">{qIndex + 1}.</span>
                <div className="lm-quiz-q-md">
                  <MarkdownContent content={question.question} />
                </div>
              </div>
              <div className="lm-quiz-options">
                {question.options.map((option, oIndex) => {
                  let stateClass = "";
                  if (result) {
                    if (oIndex === correctIndex) stateClass = "is-correct";
                    else if (oIndex === chosen) stateClass = "is-wrong";
                  } else if (oIndex === chosen) {
                    stateClass = "is-chosen";
                  }
                  return (
                    <button
                      key={oIndex}
                      type="button"
                      className={`lm-quiz-option ${stateClass}`}
                      disabled={result != null}
                      onClick={() => setAnswers((prev) => ({ ...prev, [qIndex]: oIndex }))}
                    >
                      <span className="lm-quiz-option-letter">{String.fromCharCode(65 + oIndex)}</span>
                      <span className="lm-quiz-option-text">
                        <MarkdownContent content={option} />
                      </span>
                      {result && oIndex === correctIndex ? <CheckCircle2 size={16} /> : null}
                      {result && oIndex === chosen && oIndex !== correctIndex ? <XCircle size={16} /> : null}
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}

        {error ? <div className="form-error">{error}</div> : null}

        {result == null ? (
          <div className="button-row">
            <Button onClick={() => void handleSubmitQuiz()} disabled={!allAnswered || submitting}>
              {submitting ? "Grading…" : "Submit answers"}
            </Button>
          </div>
        ) : (
          <Card className={`lm-quiz-result ${result.passed ? "is-pass" : "is-fail"}`}>
            {result.passed ? <CheckCircle2 size={30} /> : <XCircle size={30} />}
            <div className="lm-quiz-result-body">
              <strong>
                {result.score} / {result.total} {result.passed ? "- module passed" : "- not quite"}
              </strong>
              <p className="muted small">
                {result.passed
                  ? nextModule
                    ? "The next module is unlocked."
                    : "That was the last module in the track."
                  : "Reread the lesson and try the quiz again."}
              </p>
            </div>
            <div className="button-row">
              {!result.passed ? (
                <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={retryQuiz}>
                  Retry quiz
                </Button>
              ) : null}
              {result.passed && nextModule ? (
                nextModule.ready ? (
                  <Link to={`/flashcards/${numericFolderId}/modules/${nextModule.id}`} onClick={retryQuiz}>
                    <Button icon={<ArrowRight size={16} />}>Next module</Button>
                  </Link>
                ) : (
                  <Button disabled>Next module is generating…</Button>
                )
              ) : null}
              {result.passed && !nextModule ? (
                <Link to={`/flashcards/${numericFolderId}/modules`}>
                  <Button>Back to track</Button>
                </Link>
              ) : null}
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
