import Editor from "@monaco-editor/react";
import KojoMascot from "../components/KojoMascot";
import { AlertCircle, ArrowLeft, ArrowRight, Atom, Bookmark, Calculator, Check, ChevronDown, ChevronUp, Code2, Eraser, Flag, GraduationCap, Highlighter, LayoutGrid, Loader2, NotebookPen, Send, Sparkles, Strikethrough, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { TextArea } from "../components/Field";
import { InlineLoading, LoadingNotice } from "../components/Loaders";
import { KojoHelpChat } from "../components/KojoHelpChat";
import { MarkdownContent } from "../components/MarkdownContent";
import { MathInput } from "../components/MathInput";
import type { ProgressStage } from "../components/Progress";
import { ProgressOverlay, useStagedProgress } from "../components/Progress";
import { SelectionKojoAssistant } from "../components/SelectionKojoAssistant";
import { SkeletonQuestionCard } from "../components/Skeletons";
import { API_BASE_URL, fetchTest, getDraftAttempt, saveDraftAttempt, scopeKey, submitAttempt } from "../lib/api";
import { applyTextHighlights, clearTextHighlights, getSelectionSignature, HIGHLIGHT_SUPPORTED } from "../lib/highlightRanges";
import { useSettings } from "../lib/useSettings";
import type { DraftAttemptAnswer, Question, SubmittedAnswer, TestTake } from "../lib/types";

// ── Test tools (beta) localStorage helpers ──────────────────────────────────
function loadToolJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(scopeKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const toolKeys = {
  bookmarks: (testId: number) => `nosey_test_bookmarks_${testId}`,
  crossouts: (testId: number) => `nosey_test_crossouts_${testId}`,
  notes: (testId: number) => `nosey_test_notes_${testId}`,
  highlights: (testId: number) => `nosey_test_highlights_${testId}`,
};

type GenerationMeta = {
  fallback_used: boolean;
  fallback_reason?: string | null;
  note_grounded: boolean;
  retrieval_enabled: boolean;
  retrieval_total_chunks: number;
  retrieval_selected_chunks: number;
  retrieval_top_k: number;
};

export default function TakeTest() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const numericTestId = Number(testId ?? 42);
  const [test, setTest] = useState<TestTake | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [graded, setGraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationMeta, setGenerationMeta] = useState<GenerationMeta | null>(null);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [draftInfo, setDraftInfo] = useState<{ answered: number; total: number; time: string } | null>(null);

  // ── Learning Mode (beta only) ──────────────────────────────────────────────
  const { betaMode, generationProvider, kojoStrictness } = useSettings();
  const [learningMode, setLearningMode] = useState(() =>
    localStorage.getItem(scopeKey(`nosey_learning_mode_${numericTestId}`)) === "true",
  );
  const [kojoOpen, setKojoOpen] = useState(false);

  // Learning mode is only usable while beta mode is on and the test belongs to a folder.
  const learningActive = betaMode && learningMode && Boolean(test?.folder_id);

  // ── Test tools ─────────────────────────────────────────────────────────────
  // Available to all users (no LLM cost). State persists per test in localStorage.
  // Learning Mode (the LLM-backed Ask Kojo assistant) stays beta-gated separately.
  const toolsEnabled = true;
  const [navOpen, setNavOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  const [bookmarks, setBookmarks] = useState<Set<number>>(
    () => new Set(loadToolJson<number[]>(toolKeys.bookmarks(numericTestId), [])),
  );
  const [crossouts, setCrossouts] = useState<Record<number, string[]>>(
    () => loadToolJson<Record<number, string[]>>(toolKeys.crossouts(numericTestId), {}),
  );
  const [highlights, setHighlights] = useState<Record<number, string[]>>(
    () => loadToolJson<Record<number, string[]>>(toolKeys.highlights(numericTestId), {}),
  );
  const [notes, setNotes] = useState<string>(() => {
    try {
      return localStorage.getItem(scopeKey(toolKeys.notes(numericTestId))) ?? "";
    } catch {
      return "";
    }
  });
  const questionTextRef = useRef<HTMLDivElement>(null);

  // Persist tool state
  useEffect(() => {
    localStorage.setItem(scopeKey(toolKeys.bookmarks(numericTestId)), JSON.stringify([...bookmarks]));
  }, [bookmarks, numericTestId]);
  useEffect(() => {
    localStorage.setItem(scopeKey(toolKeys.crossouts(numericTestId)), JSON.stringify(crossouts));
  }, [crossouts, numericTestId]);
  useEffect(() => {
    localStorage.setItem(scopeKey(toolKeys.highlights(numericTestId)), JSON.stringify(highlights));
  }, [highlights, numericTestId]);
  useEffect(() => {
    localStorage.setItem(scopeKey(toolKeys.notes(numericTestId)), notes);
  }, [notes, numericTestId]);

  function clearToolStorage() {
    [toolKeys.bookmarks, toolKeys.crossouts, toolKeys.highlights, toolKeys.notes].forEach((fn) =>
      localStorage.removeItem(scopeKey(fn(numericTestId))),
    );
  }

  function toggleLearningMode() {
    setLearningMode((prev) => {
      const next = !prev;
      localStorage.setItem(scopeKey(`nosey_learning_mode_${numericTestId}`), String(next));
      if (!next) setKojoOpen(false);
      return next;
    });
  }

  // Ephemeral per-turn grounding sent to Kojo alongside each message (never
  // shown as a chat bubble): the question the student is currently working on.
  function buildTestKojoContext(): string {
    const currentQuestion = test?.questions[index];
    return currentQuestion ? `Question the student is working on:\n${currentQuestion.question_text}` : "";
  }

  useEffect(() => {
    fetchTest(numericTestId)
      .then(setTest)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load this test."));
  }, [numericTestId]);

  // While the test is still being generated in the background, poll for newly
  // streamed questions so they appear as soon as they are written. Polling stops
  // once generation reaches a terminal state (ready or failed) or on unmount.
  useEffect(() => {
    if (test?.generation_status !== "generating") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const fresh = await fetchTest(numericTestId);
        if (!cancelled) setTest(fresh);
      } catch {
        // Transient failure; keep polling. A persistent failure surfaces via status.
      }
    }, 1800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [test?.generation_status, numericTestId]);

  // Persist question index so resume lands on the right question
  useEffect(() => {
    if (index > 0) {
      localStorage.setItem(scopeKey(`nosey_test_index_${numericTestId}`), String(index));
    }
  }, [index, numericTestId]);

  // Arrow keys to navigate test questions
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return; // Don't interfere with typing
      }
      // Don't interfere with the STEM answer editor: the MathLive <math-field>
      // web component and the on-screen symbol keyboard are not <input>/<textarea>,
      // so their arrow keys would otherwise fall through and jump questions.
      if (event.target instanceof Element && event.target.closest(".math-input-wrap")) {
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((currentIndex) => {
          if (!test) return currentIndex;
          const loaded = test.questions.length;
          const generating = (test.generation_status ?? "ready") === "generating";
          const expected = test.expected_question_count ?? loaded;
          // While generating, allow stepping one slot past the last loaded question
          // (a pending slot that shows a spinner), but never past the expected end.
          const ceiling = generating ? Math.min(loaded, Math.max(expected - 1, 0)) : loaded - 1;
          return Math.min(currentIndex + 1, ceiling);
        });
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((currentIndex) => Math.max(currentIndex - 1, 0));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [test]);

  // Load draft if it exists
  useEffect(() => {
    async function loadDraft() {
      const draft = await getDraftAttempt(numericTestId);
      if (draft && draft.answers.length > 0) {
        const draftAnswers: Record<number, string> = {};
        draft.answers.forEach((ans) => {
          draftAnswers[ans.question_id] = ans.user_answer;
        });
        const answered = Object.values(draftAnswers).filter(Boolean).length;
        const exitedTime = draft.exited_at ? new Date(draft.exited_at).toLocaleString() : "unknown";
        setDraftInfo({
          answered,
          total: draft.answers.length,
          time: exitedTime,
        });
        setShowResumeDialog(true);
        // Don't load answers yet - wait for user to confirm
        sessionStorage.setItem(`_draft_answers_${numericTestId}`, JSON.stringify(draftAnswers));
      }
    }
    loadDraft();
  }, [numericTestId]);

  useEffect(() => {
    const key = `nosey_generation_meta_${numericTestId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as GenerationMeta;
      setGenerationMeta(parsed);
    } catch {
      setGenerationMeta(null);
    }
  }, [numericTestId]);

  // Auto-save answers when they change
  useEffect(() => {
    const timer = setTimeout(() => {
      const draftAnswers: DraftAttemptAnswer[] = Object.entries(answers).map(([qid, answer]) => ({
        question_id: Number(qid),
        user_answer: answer,
      }));
      if (draftAnswers.length > 0) {
        saveDraftAttempt(numericTestId, draftAnswers).catch((err) =>
          console.error("Draft auto-save failed:", err),
        );
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [answers, numericTestId]);

  // Save draft on page leave
  useEffect(() => {
    function handleBeforeUnload() {
      const draftAnswers: DraftAttemptAnswer[] = Object.entries(answers).map(([qid, answer]) => ({
        question_id: Number(qid),
        user_answer: answer,
      }));
      if (draftAnswers.length > 0) {
        // Use synchronous API call via navigator.sendBeacon if available
        const payload = JSON.stringify({
          answers: draftAnswers,
        });
        navigator.sendBeacon(
          `${API_BASE_URL}/tests/${numericTestId}/attempts/draft`,
          payload,
        );
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [answers, numericTestId]);

  function handleResume() {
    const draftAnswers = sessionStorage.getItem(`_draft_answers_${numericTestId}`);
    if (draftAnswers) {
      setAnswers(JSON.parse(draftAnswers) as Record<number, string>);
      sessionStorage.removeItem(`_draft_answers_${numericTestId}`);
    }
    const savedIndex = localStorage.getItem(scopeKey(`nosey_test_index_${numericTestId}`));
    if (savedIndex !== null) setIndex(Number(savedIndex));
    setShowResumeDialog(false);
  }

  function handleStartFresh() {
    setAnswers({});
    localStorage.removeItem(scopeKey(`nosey_test_index_${numericTestId}`));
    setShowResumeDialog(false);
  }

  const question = test?.questions[index];
  const questionId = question?.id;

  // ── Streaming generation state ─────────────────────────────────────────────
  const genStatus = test?.generation_status ?? "ready";
  const isGenerating = genStatus === "generating";
  const genFailed = genStatus === "failed";
  const loadedCount = test?.questions.length ?? 0;
  const expectedCount = test?.expected_question_count ?? loadedCount;
  // Slots to show in the progress denominator: the expected total while still
  // generating, otherwise however many actually landed.
  const totalSlots = isGenerating ? Math.max(expectedCount, loadedCount) : loadedCount;
  const lastLoadedIndex = loadedCount - 1;
  // Highest reachable index: one pending slot past the last loaded question while
  // generating (so the student can see a spinner for the next question), else the
  // last loaded question.
  const maxIndex = isGenerating ? Math.min(loadedCount, Math.max(expectedCount - 1, 0)) : lastLoadedIndex;

  // Keep the current index inside the reachable range whenever that range
  // shrinks. Generation can finish "ready" with fewer questions than
  // expected_question_count (best-effort extra types, dedup, validators), and
  // the student may be parked on the pending slot one past the last loaded
  // question. Without this clamp they would be stuck on a "Writing question
  // N..." spinner that never resolves (GH #35). The resume flow can also
  // restore an out-of-range saved index; this covers that too.
  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(maxIndex, 0)));
  }, [maxIndex]);

  // Re-paint persisted highlights for the current question after each render.
  useEffect(() => {
    if (!toolsEnabled || questionId == null) return;
    const container = questionTextRef.current;
    if (!container) return;
    applyTextHighlights(container, highlights[questionId] ?? []);
    return () => clearTextHighlights();
  }, [toolsEnabled, questionId, highlights, index]);

  function toggleBookmark() {
    if (questionId == null) return;
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }

  function toggleCrossout(optionId: string) {
    if (questionId == null) return;
    setCrossouts((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      return { ...prev, [questionId]: next };
    });
  }

  function captureHighlight() {
    if (!highlightMode || questionId == null) return;
    const container = questionTextRef.current;
    if (!container) return;
    const signature = getSelectionSignature(container);
    if (!signature) return;
    setHighlights((prev) => {
      const existing = prev[questionId] ?? [];
      if (existing.includes(signature)) return prev;
      return { ...prev, [questionId]: [...existing, signature] };
    });
    window.getSelection()?.removeAllRanges();
  }

  function clearCurrentHighlights() {
    if (questionId == null) return;
    setHighlights((prev) => {
      if (!prev[questionId]?.length) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }

  const answeredCount = test ? test.questions.filter((item) => isQuestionAnswered(item, answers[item.id])).length : 0;
  const progress = totalSlots ? ((index + 1) / totalSlots) * 100 : 0;
  // Can only submit once generation has finished and every loaded question is answered.
  const canSubmit = test && !isGenerating && loadedCount > 0
    ? test.questions.every((item) => isQuestionAnswered(item, answers[item.id]))
    : false;
  const isMathMode = Boolean(test?.is_math_mode);
  const isCodingMode = Boolean(test?.is_coding_mode);
  const codingLanguage = test?.coding_language ?? "python";

  // Letter keys A-D to select MCQ options
  useEffect(() => {
    function handleLetterKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!question || question.type !== "MCQ") return;
      const key = event.key.toLowerCase();
      const map: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
      const idx = map[key];
      if (idx === undefined) return;
      event.preventDefault();
      const opt = question.options[idx];
      if (opt) {
        setAnswers((prev) => ({ ...prev, [question.id]: opt.text }));
      }
    }

    window.addEventListener("keydown", handleLetterKey);
    return () => window.removeEventListener("keydown", handleLetterKey);
  }, [question]);

  const submittedAnswers = useMemo<SubmittedAnswer[]>(
    () =>
      Object.entries(answers)
        .filter(([, answer]) => answer.trim())
        .map(([question_id, answer]) => ({ question_id: Number(question_id), answer })),
    [answers],
  );

  // Grading is one round trip, so there is nothing real to count. What we do
  // know is the pipeline: the answer key is instant, and every written answer
  // goes to Kojo, which is what makes a long test slow. Sizing the stages off
  // the actual question mix keeps the bar's pace roughly honest.
  const gradingStages = useMemo<ProgressStage[]>(() => {
    const questions = test?.questions ?? [];
    const written = questions.filter((question) => question.type === "FRQ").length;
    const keyed = questions.length - written;
    const stages: ProgressStage[] = [{ label: "Collecting your answers", seconds: 1.5 }];
    if (keyed > 0) {
      stages.push({ label: "Checking against the answer key", seconds: 2 });
    }
    if (written > 0) {
      stages.push({
        label:
          written === 1 ? "Reading your written answer" : `Reading your ${written} written answers`,
        seconds: Math.max(5, written * 3),
      });
    }
    stages.push({ label: "Scoring and writing feedback", seconds: 3.5 });
    return stages;
  }, [test]);

  const hasWrittenAnswers = gradingStages.some((stage) => stage.label.startsWith("Reading"));
  const grading = useStagedProgress(gradingStages, { running: isSubmitting, done: graded });

  async function handleSubmit() {
    if (!test || !canSubmit) return;
    setIsSubmitting(true);
    setGraded(false);
    try {
      const result = await submitAttempt(test.id, submittedAnswers);
      localStorage.removeItem(scopeKey(`nosey_test_index_${numericTestId}`));
      clearToolStorage();
      sessionStorage.setItem(`nosey_attempt_${result.attempt_id}`, JSON.stringify(result));
      const completedKey = scopeKey("nosey_completed_test_ids");
      const existing = JSON.parse(localStorage.getItem(completedKey) ?? "[]") as number[];
      localStorage.setItem(completedKey, JSON.stringify([...new Set([...existing, test.id])]));
      // Let the bar finish its run to 100 and the last stage tick over before
      // leaving. Cutting straight to results throws away the payoff.
      setGraded(true);
      window.setTimeout(() => navigate(`/results/${result.attempt_id}`), 700);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit this test.");
      setIsSubmitting(false);
      setGraded(false);
    }
  }

  if (!test) {
    if (error) {
      return (
        <div className="page page-narrow">
          <EmptyState
            icon={<ArrowLeft />}
            title="Test not available"
            body={error}
            action={
              <Link to="/dashboard">
                <Button>Back to Dashboard</Button>
              </Link>
            }
          />
        </div>
      );
    }
    // The question card is the whole page, so stand in for it rather than
    // spinning: pill, prompt, and option rows exactly where they will land.
    return (
      <div className="page page-narrow">
        <SkeletonQuestionCard />
      </div>
    );
  }

  // Test shell loaded but no questions yet: either still warming up the first batch,
  // or generation reached a terminal state without producing anything.
  if (loadedCount === 0) {
    // "failed" is the explicit error state; "ready" with zero questions means
    // generation finished but every question was dropped (validators, dedup).
    // Both are terminal, so show an end state instead of the splash: the poll
    // only runs while status is "generating", so the splash would spin forever.
    if (genFailed || !isGenerating) {
      return (
        <div className="page page-narrow">
          <EmptyState
            icon={<AlertCircle />}
            title={genFailed ? "Generation failed" : "No questions were generated"}
            body={
              test.generation_error ||
              error ||
              (genFailed
                ? "We could not generate this test. Try again from the folder."
                : "Generation finished without producing any questions. Retry it from the folder.")
            }
            action={
              <Link to={test.folder_id ? `/folders/${test.folder_id}` : "/dashboard"}>
                <Button>Back to folder</Button>
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="page centered-block">
        <div className="test-generating-splash">
          <LoadingNotice
            title="Generating your test"
            estimate={
              expectedCount > 0
                ? `Writing ${expectedCount} questions. The first one usually lands within 20 seconds.`
                : "The first question usually lands within 20 seconds."
            }
            slowNote="Still writing. Dense notes can take a minute or more. You can leave this page, generation keeps running and the test will be waiting in your folder."
            slowAfterMs={25000}
          />
          <Link
            className="back-link"
            to={test.folder_id ? `/folders/${test.folder_id}` : "/dashboard"}
            style={{ marginTop: 12 }}
          >
            <ArrowLeft size={16} />
            {test.folder_id ? "Back to folder" : "Back to dashboard"}
          </Link>
        </div>
      </div>
    );
  }

  // Last answerable question: only true once generation is done and we are on the
  // final loaded question (so Submit never appears mid-stream).
  const onLastReal = !isGenerating && index === lastLoadedIndex;

  return (
    <div className="test-screen">
      {showResumeDialog && draftInfo && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <Card style={{
            maxWidth: "400px",
            padding: "24px",
          }}>
            <div style={{ marginBottom: "16px" }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "bold" }}>Resume Previous Test?</h3>
              <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "var(--gray-600)" }}>
                You have a draft with {draftInfo.answered} of {draftInfo.total} questions answered.
              </p>
              <p style={{ margin: "0", fontSize: "12px", color: "var(--gray-500)" }}>
                Last edited: {draftInfo.time}
              </p>
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={handleStartFresh}>
                Start Fresh
              </Button>
              <Button icon={<Undo2 size={16} />} onClick={handleResume}>
                Resume
              </Button>
            </div>
          </Card>
        </div>
      )}
      <div className="test-progress">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <header>
          <Link className="back-link" to={test.folder_id ? `/folders/${test.folder_id}` : "/folders"}>
            <ArrowLeft size={16} />
            Folder
          </Link>
          <div>
            <strong>
              {test.title}
              {isMathMode && (
                <span className="math-mode-badge">
                  <Atom size={12} />
                  STEM
                </span>
              )}
              {isCodingMode && (
                <span className="math-mode-badge" style={{ background: "var(--blue-light, #ebf8ff)", color: "var(--blue-dark, #2b6cb0)" }}>
                  <Code2 size={12} />
                  {codingLanguage}
                </span>
              )}
            </strong>
            <span>
              Question {index + 1} of {totalSlots}
              {isGenerating ? ` · ${loadedCount} generated so far` : ` · ${answeredCount} answered`}
            </span>
          </div>
          {betaMode && test.folder_id && (
            <button
              type="button"
              className={`learning-mode-toggle${learningMode ? " learning-mode-toggle--on" : ""}`}
              onClick={toggleLearningMode}
              aria-pressed={learningMode}
              title="Learning Mode lets you highlight text and ask Kojo, grounded in your notes"
            >
              <GraduationCap size={15} />
              Learning Mode
            </button>
          )}
        </header>
        {toolsEnabled && question && (
          <div className="test-tools-wrap">
            <div className="test-tools-bar">
              <button
                type="button"
                className={`test-tool-btn${navOpen ? " test-tool-btn--active" : ""}`}
                onClick={() => setNavOpen((open) => !open)}
                aria-expanded={navOpen}
              >
                <LayoutGrid size={15} />
                Questions
              </button>
              <button
                type="button"
                className={`test-tool-btn${bookmarks.has(question.id) ? " test-tool-btn--active" : ""}`}
                onClick={toggleBookmark}
                title="Bookmark this question to come back to it"
              >
                <Bookmark size={15} />
                {bookmarks.has(question.id) ? "Stuck" : "Mark stuck"}
              </button>
              {HIGHLIGHT_SUPPORTED && (
                <button
                  type="button"
                  className={`test-tool-btn${highlightMode ? " test-tool-btn--active" : ""}`}
                  onClick={() => setHighlightMode((on) => !on)}
                  aria-pressed={highlightMode}
                  title="Highlight text in the question"
                >
                  <Highlighter size={15} />
                  Highlight
                </button>
              )}
              <button
                type="button"
                className={`test-tool-btn${notesOpen ? " test-tool-btn--active" : ""}`}
                onClick={() => setNotesOpen((open) => !open)}
                aria-pressed={notesOpen}
              >
                <NotebookPen size={15} />
                Notes
              </button>
            </div>
            {navOpen && (
              <div className="test-nav-pop" role="menu">
                <div className="test-nav-pop-head">
                  <span>Jump to question</span>
                  <button type="button" className="test-nav-pop-close" onClick={() => setNavOpen(false)} aria-label="Close">
                    <X size={15} />
                  </button>
                </div>
                <div className="test-nav-grid">
                  {test.questions.map((item, itemIndex) => {
                    const answered = isQuestionAnswered(item, answers[item.id]);
                    const marked = bookmarks.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`test-nav-chip${itemIndex === index ? " test-nav-chip--current" : ""}${answered ? " test-nav-chip--answered" : ""}${marked ? " test-nav-chip--marked" : ""}`}
                        onClick={() => {
                          setIndex(itemIndex);
                          setNavOpen(false);
                        }}
                      >
                        <span>{itemIndex + 1}</span>
                        {marked ? <Flag size={11} className="test-nav-chip-flag" /> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="test-nav-legend">
                  <span><i className="test-nav-dot test-nav-dot--answered" /> Answered</span>
                  <span><Flag size={11} /> Stuck</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <main className="question-wrap">
        {generationMeta?.fallback_used ? (
          <div className="generation-banner generation-banner-warning">
            Question generation used fallback content because the model response was unavailable or invalid.
            <span>
              Reason: {generationMeta.fallback_reason ?? "unknown"}. These questions may be less grounded in your uploaded notes.
            </span>
          </div>
        ) : generationMeta?.retrieval_enabled ? (
          <div className="generation-banner generation-banner-info">
            Questions were retrieval-grounded using {generationMeta.retrieval_selected_chunks} of {generationMeta.retrieval_total_chunks} note chunks.
          </div>
        ) : null}
        {learningActive && (
          <div className="learning-mode-bar">
            <span className="learning-mode-bar-hint">
              <Sparkles size={14} />
              Highlight any text to ask Kojo, grounded in your notes.
            </span>
            <button type="button" className="learning-mode-ask-btn" onClick={() => setKojoOpen(true)}>
              <KojoMascot state="idle" />
              Ask Kojo
            </button>
          </div>
        )}
        {isGenerating ? (
          <div className="generation-banner generation-banner-streaming">
            <Loader2 size={14} className="spin" />
            Generating questions... {loadedCount} of {totalSlots} ready. You can start answering now.
          </div>
        ) : genFailed ? (
          <div className="generation-banner generation-banner-warning">
            Generation stopped early. {loadedCount} of {expectedCount} questions are available.
            <span>
              {test.generation_error
                ? `Reason: ${test.generation_error}`
                : "You can take these now, or retry generation from the folder."}
            </span>
          </div>
        ) : null}
        {(() => {
          if (!question) {
            // Belt and braces: only show the "writing..." slot while generation
            // is actually running. If the index is out of range after generation
            // ended, the clamp effect snaps it back to the last real question on
            // the next render, so render nothing for that one frame instead of a
            // spinner that would never resolve.
            if (!isGenerating) return null;
            return (
              <Card className="question-card question-card--pending">
                <div className="test-pending-slot">
                  <Loader2 size={26} className="spin" />
                  <strong>Writing question {index + 1}...</strong>
                  <span className="muted">{loadedCount} of {totalSlots} questions ready</span>
                </div>
              </Card>
            );
          }
          const questionCard = (
            <Card className="question-card">
              <div className="question-card-top">
                <span className="pill">{questionTypeLabel(question)}</span>
                {toolsEnabled && bookmarks.has(question.id) ? (
                  <span className="question-stuck-badge"><Flag size={12} /> Stuck</span>
                ) : null}
              </div>
              {toolsEnabled && highlightMode ? (
                <div className="test-highlight-hint">
                  <span><Highlighter size={14} /> Select text in the question to highlight it.</span>
                  {(highlights[question.id]?.length ?? 0) > 0 ? (
                    <button type="button" className="test-highlight-clear" onClick={clearCurrentHighlights}>
                      <Eraser size={13} /> Clear
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div
                className="test-question-markdown"
                ref={questionTextRef}
                onMouseUp={toolsEnabled ? captureHighlight : undefined}
                onTouchEnd={toolsEnabled ? captureHighlight : undefined}
              >
                <MarkdownContent content={question.question_text} />
              </div>
              {question.type === "MCQ" ? (
                <MCQQuestion
                  question={question}
                  answer={answers[question.id]}
                  onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })}
                  toolsEnabled={toolsEnabled}
                  crossed={crossouts[question.id] ?? []}
                  onToggleCross={toggleCrossout}
                />
              ) : question.type === "TF" ? (
                <TFQuestion
                  question={question}
                  answer={answers[question.id]}
                  onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })}
                />
              ) : question.type === "MS" ? (
                <MSQuestion
                  question={question}
                  answer={answers[question.id]}
                  onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })}
                />
              ) : question.type === "RANK" ? (
                <RankQuestion
                  question={question}
                  answer={answers[question.id]}
                  onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })}
                />
              ) : isCodingMode ? (
                <div className="code-editor-wrap">
                  <label className="field-label">Your code</label>
                  <div className="code-editor-frame">
                    <Editor
                      height="320px"
                      language={codingLanguage.toLowerCase()}
                      value={answers[question.id] ?? ""}
                      onChange={(val) => setAnswers({ ...answers, [question.id]: val ?? "" })}
                      theme="vs-dark"
                      options={{
                        fontSize: 14,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        lineNumbers: "on",
                        wordWrap: "on",
                        automaticLayout: true,
                      }}
                    />
                  </div>
                  <p className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
                    Write your solution in {codingLanguage}. Your code will be reviewed by AI.
                  </p>
                </div>
              ) : isMathMode ? (
                <MathInput
                  value={answers[question.id] ?? ""}
                  onChange={(val) => setAnswers({ ...answers, [question.id]: val })}
                />
              ) : (
                <TextArea
                  label="Your answer"
                  value={answers[question.id] ?? ""}
                  onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
                  placeholder="Use the details from your notes..."
                />
              )}
            </Card>
          );
          if (learningActive && test.folder_id) {
            return (
              <SelectionKojoAssistant
                folderId={test.folder_id}
                folderName={test.folder_name ?? "this folder"}
              >
                {questionCard}
              </SelectionKojoAssistant>
            );
          }
          return questionCard;
        })()}

        <div className="question-nav">
          <Button variant="secondary" disabled={index === 0} icon={<ArrowLeft size={18} />} onClick={() => setIndex(index - 1)}>
            Previous
          </Button>
          {onLastReal ? (
            <Button disabled={!canSubmit || isSubmitting} icon={<Send size={18} />} onClick={handleSubmit}>
              {isSubmitting ? <InlineLoading label="Submitting" /> : "Submit"}
            </Button>
          ) : index >= maxIndex ? (
            <Button variant="secondary" disabled icon={<Loader2 size={18} className="spin" />}>
              Generating...
            </Button>
          ) : (
            <Button icon={<ArrowRight size={18} />} onClick={() => setIndex(Math.min(index + 1, maxIndex))}>
              Next
            </Button>
          )}
        </div>
      </main>

      {toolsEnabled && notesOpen && (
        <div className="test-notes-panel">
          <div className="test-notes-head">
            <span><NotebookPen size={15} /> Scratch notes</span>
            <button type="button" className="test-notes-close" onClick={() => setNotesOpen(false)} aria-label="Close notes">
              <X size={16} />
            </button>
          </div>
          <textarea
            className="test-notes-textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Jot down your working, formulas, or things to revisit..."
          />
          <p className="test-notes-hint">Saved on this device for this test.</p>
        </div>
      )}

      {kojoOpen && test && (
        <KojoHelpChat
          storageKey={`test:${numericTestId}`}
          subtitle={test.title}
          onClose={() => setKojoOpen(false)}
          buildContext={buildTestKojoContext}
          customInstruction="You're helping a student during a practice test in Learning Mode. Help them understand the underlying concept and reason toward the answer. Guide their thinking, do not just hand over the final answer to the test question."
          provider={generationProvider}
          strictness={kojoStrictness}
          contractNote="Kojo answers from your uploaded notes to help you understand the material. It guides your thinking instead of handing over the answer."
          emptyTitle="Stuck on this question?"
          emptySub="Ask Kojo about the concept behind it. I'll guide your thinking instead of handing over the answer."
          suggestions={["Explain the concept this question is testing", "Give me a hint without the answer", "What should I review first?"]}
        />
      )}

      {isSubmitting ? (
        <ProgressOverlay
          eyebrow="Marking"
          title="Grading your test"
          percent={grading.percent}
          stages={gradingStages}
          activeStage={grading.activeStage}
          note={
            hasWrittenAnswers
              ? "Kojo reads every written answer, which is the slow part. Keep this page open."
              : "Keep this page open. Your results are almost ready."
          }
        />
      ) : null}
    </div>
  );
}

function MCQQuestion({
  question,
  answer,
  onAnswer,
  toolsEnabled = false,
  crossed = [],
  onToggleCross,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
  toolsEnabled?: boolean;
  crossed?: string[];
  onToggleCross?: (optionId: string) => void;
}) {
  return (
    <div className="option-grid">
      {question.options.map((option, optionIndex) => {
        const selected = answer === option.text;
        const optionId = String(option.id);
        const isCrossed = crossed.includes(optionId);
        return (
          <div className={`option-row${isCrossed ? " option-row--crossed" : ""}`} key={option.id}>
            <button
              className={`option-button ${selected ? "selected" : ""}`}
              onClick={() => onAnswer(option.text)}
              type="button"
            >
              <span className="option-label">{String.fromCharCode(65 + optionIndex)}</span>
              <div className="test-option-markdown">
                <MarkdownContent content={option.text} />
              </div>
              {selected ? <Check size={18} /> : null}
            </button>
            {toolsEnabled && onToggleCross ? (
              <button
                type="button"
                className={`option-cross-btn${isCrossed ? " option-cross-btn--on" : ""}`}
                onClick={() => onToggleCross(optionId)}
                aria-pressed={isCrossed}
                title={isCrossed ? "Restore this option" : "Cross out this option"}
              >
                <Strikethrough size={15} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// True/False renders the two stored options ("True"/"False") as distinct buttons.
function TFQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  return (
    <div className="tf-grid">
      {question.options.map((option) => {
        const selected = answer === option.text;
        const isTrue = option.text.trim().toLowerCase() === "true";
        return (
          <button
            key={option.id}
            type="button"
            className={`tf-button${isTrue ? " tf-true" : " tf-false"}${selected ? " selected" : ""}`}
            onClick={() => onAnswer(option.text)}
          >
            {isTrue ? <Check size={22} /> : <X size={22} />}
            <span>{option.text}</span>
          </button>
        );
      })}
    </div>
  );
}

// Multiple Select: answer is a JSON array of the selected option texts.
function MSQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  const selected = useMemo<string[]>(() => {
    if (!answer) return [];
    try {
      const parsed = JSON.parse(answer);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }, [answer]);

  function toggle(text: string) {
    const next = selected.includes(text) ? selected.filter((t) => t !== text) : [...selected, text];
    onAnswer(JSON.stringify(next));
  }

  return (
    <div className="option-grid">
      <p className="ms-hint">Select all that apply.</p>
      {question.options.map((option) => {
        const isSelected = selected.includes(option.text);
        return (
          <button
            key={option.id}
            type="button"
            className={`option-button ms-option ${isSelected ? "selected" : ""}`}
            onClick={() => toggle(option.text)}
          >
            <span className={`ms-check${isSelected ? " on" : ""}`}>{isSelected ? <Check size={15} /> : null}</span>
            <div className="test-option-markdown">
              <MarkdownContent content={option.text} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Ranking: answer is a JSON array of option texts in the student's chosen order.
function RankQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  const order = useMemo<string[]>(() => {
    if (answer) {
      try {
        const parsed = JSON.parse(answer);
        if (Array.isArray(parsed) && parsed.length === question.options.length) return parsed.map(String);
      } catch {
        // fall through to the option order
      }
    }
    return question.options.map((option) => option.text);
  }, [answer, question.options]);

  // Persist the initial order once so the question counts as answered even if the
  // student never reorders it (they just risk getting it wrong, all-or-nothing).
  useEffect(() => {
    if (!answer) onAnswer(JSON.stringify(question.options.map((option) => option.text)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onAnswer(JSON.stringify(next));
  }

  return (
    <div className="rank-list">
      <p className="ms-hint">Put these in the correct order. Top is first.</p>
      {order.map((text, position) => (
        <div key={text} className="rank-item">
          <span className="rank-num">{position + 1}</span>
          <div className="rank-item-text test-option-markdown">
            <MarkdownContent content={text} />
          </div>
          <div className="rank-item-actions">
            <button type="button" onClick={() => move(position, -1)} disabled={position === 0} aria-label="Move up">
              <ChevronUp size={16} />
            </button>
            <button type="button" onClick={() => move(position, 1)} disabled={position === order.length - 1} aria-label="Move down">
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function questionTypeLabel(question: Question): string {
  switch (question.type) {
    case "MCQ":
      return "Multiple choice";
    case "TF":
      return "True or false";
    case "MS":
      return "Multiple select";
    case "RANK":
      return "Ranking";
    default:
      return "Free response";
  }
}

function isQuestionAnswered(question: Question, answer?: string): boolean {
  if (!answer || !answer.trim()) return false;
  if (question.type === "MS") {
    try {
      const parsed = JSON.parse(answer);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }
  return answer.trim().length > 0;
}
