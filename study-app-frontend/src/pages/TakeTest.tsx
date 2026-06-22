import Editor from "@monaco-editor/react";
import { AlertCircle, ArrowLeft, ArrowRight, Bookmark, Bot, Calculator, Check, ChevronDown, ChevronUp, Code2, Eraser, Flag, GraduationCap, Highlighter, LayoutGrid, NotebookPen, Send, Sparkles, Strikethrough, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { TextArea } from "../components/Field";
import { MarkdownContent } from "../components/MarkdownContent";
import { MathInput } from "../components/MathInput";
import { SelectionKojoAssistant } from "../components/SelectionKojoAssistant";
import { API_BASE_URL, fetchTest, getDraftAttempt, kojoChat, saveDraftAttempt, scopeKey, submitAttempt } from "../lib/api";
import { applyTextHighlights, clearTextHighlights, getContainedSelectionText, HIGHLIGHT_SUPPORTED } from "../lib/highlightRanges";
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
  const [kojoInput, setKojoInput] = useState("");
  const [kojoResponse, setKojoResponse] = useState<string | null>(null);
  const [kojoLoading, setKojoLoading] = useState(false);
  const [kojoError, setKojoError] = useState<string | null>(null);

  // Learning mode is only usable while beta mode is on and the test belongs to a folder.
  const learningActive = betaMode && learningMode && Boolean(test?.folder_id);

  // ── Test tools (beta only) ─────────────────────────────────────────────────
  // All tools are gated behind beta mode and persist per test in localStorage.
  const toolsEnabled = betaMode;
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

  function openKojo(prefill?: string) {
    setKojoResponse(null);
    setKojoError(null);
    setKojoInput(prefill ?? "");
    setKojoOpen(true);
  }

  async function handleKojoSend() {
    const message = kojoInput.trim();
    if (!test?.folder_id || !message || kojoLoading) return;
    setKojoLoading(true);
    setKojoError(null);
    setKojoResponse(null);
    try {
      const currentQuestion = test.questions[index];
      const prompt = [
        "You are Kojo, a study companion helping a student during a practice test in Learning Mode.",
        "Help the student understand the underlying concept and reason toward the answer.",
        "Guide their thinking, do not just hand over the final answer to the test question.",
        "",
        currentQuestion ? `Question the student is working on:\n${currentQuestion.question_text}` : "",
        "",
        `Student's question:\n${message}`,
      ]
        .filter(Boolean)
        .join("\n");
      const result = await kojoChat(test.folder_id, prompt, generationProvider, kojoStrictness);
      setKojoResponse(result.response);
    } catch (err) {
      setKojoError(err instanceof Error ? err.message : "Kojo failed to respond.");
    } finally {
      setKojoLoading(false);
    }
  }

  useEffect(() => {
    fetchTest(numericTestId)
      .then(setTest)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load this test."));
  }, [numericTestId]);

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
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((currentIndex) => {
          if (!test) return currentIndex;
          return Math.min(currentIndex + 1, test.questions.length - 1);
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
    const text = getContainedSelectionText(container);
    if (!text) return;
    setHighlights((prev) => {
      const existing = prev[questionId] ?? [];
      if (existing.includes(text)) return prev;
      return { ...prev, [questionId]: [...existing, text] };
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
  const progress = test ? ((index + 1) / test.questions.length) * 100 : 0;
  const canSubmit = test ? test.questions.every((item) => isQuestionAnswered(item, answers[item.id])) : false;
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

  async function handleSubmit() {
    if (!test || !canSubmit) return;
    setIsSubmitting(true);
    try {
      const result = await submitAttempt(test.id, submittedAnswers);
      localStorage.removeItem(scopeKey(`nosey_test_index_${numericTestId}`));
      clearToolStorage();
      sessionStorage.setItem(`nosey_attempt_${result.attempt_id}`, JSON.stringify(result));
      const completedKey = scopeKey("nosey_completed_test_ids");
      const existing = JSON.parse(localStorage.getItem(completedKey) ?? "[]") as number[];
      localStorage.setItem(completedKey, JSON.stringify([...new Set([...existing, test.id])]));
      navigate(`/results/${result.attempt_id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit this test.");
      setIsSubmitting(false);
    }
  }

  if (!test || !question) {
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
    return (
      <div className="page centered-block">
        <span className="loader" />
      </div>
    );
  }

  const isLast = index === test.questions.length - 1;

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
          <Link className="back-link" to="/dashboard">
            <ArrowLeft size={16} />
            Dashboard
          </Link>
          <div>
            <strong>
              {test.title}
              {isMathMode && (
                <span className="math-mode-badge">
                  <Calculator size={12} />
                  Math
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
              Question {index + 1} of {test.questions.length} · {answeredCount} answered
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
            <button type="button" className="learning-mode-ask-btn" onClick={() => openKojo()}>
              <Bot size={15} />
              Ask Kojo
            </button>
          </div>
        )}
        {(() => {
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
          {isLast ? (
            <Button disabled={!canSubmit || isSubmitting} icon={<Send size={18} />} onClick={handleSubmit}>
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          ) : (
            <Button icon={<ArrowRight size={18} />} onClick={() => setIndex(index + 1)}>
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

      {kojoOpen && (
        <>
          <div className="lc-kojo-backdrop" onClick={() => { setKojoOpen(false); setKojoResponse(null); }} />
          <div className="lc-kojo-modal">
            <div className="lc-kojo-modal-header">
              <div className="kojo-avatar"><Bot size={16} /></div>
              <span><Sparkles size={13} className="kojo-title-icon" /> Ask Kojo</span>
              <button type="button" className="lc-kojo-close" onClick={() => { setKojoOpen(false); setKojoResponse(null); }} aria-label="Close">
                <X size={17} />
              </button>
            </div>

            <div className="lc-kojo-contract">
              <p>Kojo answers from your uploaded notes to help you understand the material. It guides your thinking instead of handing over the answer.</p>
            </div>

            <div className="lc-kojo-input-wrap">
              <textarea
                className="lc-kojo-input"
                rows={5}
                value={kojoInput}
                onChange={(event) => setKojoInput(event.target.value)}
                placeholder="Ask Kojo about this question or the concept behind it..."
                disabled={kojoLoading}
              />
            </div>

            {kojoResponse ? <div className="lc-kojo-response"><MarkdownContent content={kojoResponse} /></div> : null}
            {kojoError ? <div className="kojo-error"><AlertCircle size={14} /><span>{kojoError}</span></div> : null}

            <div className="lc-kojo-modal-footer">
              {kojoLoading ? (
                <div className="kojo-thinking"><span /><span /><span /></div>
              ) : (
                <button type="button" className="button button--primary lc-kojo-send" onClick={() => void handleKojoSend()} disabled={!kojoInput.trim()}>
                  <Send size={15} />
                  {kojoResponse ? "Ask again" : "Ask Kojo"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
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
