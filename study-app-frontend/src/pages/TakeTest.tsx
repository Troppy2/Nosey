import Editor from "@monaco-editor/react";
import { ArrowLeft, ArrowRight, Calculator, Check, Code2, Send, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { TextArea } from "../components/Field";
import { MarkdownContent } from "../components/MarkdownContent";
import { MathInput } from "../components/MathInput";
import { fetchTest, getDraftAttempt, saveDraftAttempt, submitAttempt } from "../lib/api";
import type { DraftAttemptAnswer, Question, SubmittedAnswer, TestTake } from "../lib/types";

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

  useEffect(() => {
    fetchTest(numericTestId)
      .then(setTest)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load this test."));
  }, [numericTestId]);

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
          `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"}/tests/${numericTestId}/attempts/draft`,
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
    setShowResumeDialog(false);
  }

  function handleStartFresh() {
    setAnswers({});
    setShowResumeDialog(false);
  }

  const question = test?.questions[index];
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
      sessionStorage.setItem(`nosey_attempt_${result.attempt_id}`, JSON.stringify(result));
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
        </header>
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
        <Card className="question-card">
          <span className="pill">{questionTypeLabel(question)}</span>
          <div className="test-question-markdown">
            <MarkdownContent content={question.question_text} />
          </div>
          {question.type === "MCQ" ? (
            <MCQQuestion question={question} answer={answers[question.id]} onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })} />
          ) : question.type === "select_all" ? (
            <SelectAllQuestion
              question={question}
              answer={answers[question.id]}
              onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })}
            />
          ) : question.type === "matching" ? (
            <MatchingQuestion
              question={question}
              answer={answers[question.id]}
              onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })}
            />
          ) : question.type === "ordering" ? (
            <OrderingQuestion
              question={question}
              answer={answers[question.id]}
              onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })}
            />
          ) : question.type === "fill_blank" ? (
            <FillBlankQuestion
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
    </div>
  );
}

function MCQQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  return (
    <div className="option-grid">
      {question.options.map((option, optionIndex) => {
        const selected = answer === option.text;
        return (
          <button className={`option-button ${selected ? "selected" : ""}`} key={option.id} onClick={() => onAnswer(option.text)} type="button">
            <span className="option-label">{String.fromCharCode(65 + optionIndex)}</span>
            <div className="test-option-markdown">
              <MarkdownContent content={option.text} />
            </div>
            {selected ? <Check size={18} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function SelectAllQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  const selectedIndices = parseIndexList(answer);

  function toggle(optionIndex: number) {
    const next = selectedIndices.includes(optionIndex)
      ? selectedIndices.filter((index) => index !== optionIndex)
      : [...selectedIndices, optionIndex].sort((left, right) => left - right);
    onAnswer(JSON.stringify(next));
  }

  return (
    <div className="beta-question-stack">
      {question.options.map((option, optionIndex) => {
        const selected = selectedIndices.includes(optionIndex);
        return (
          <button
            className={`beta-option-card${selected ? " beta-option-card--selected" : ""}`}
            key={option.id}
            onClick={() => toggle(optionIndex)}
            type="button"
          >
            <input type="checkbox" checked={selected} readOnly />
            <div className="test-option-markdown">
              <MarkdownContent content={option.text} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MatchingQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  const selected = parseMatchingAnswer(answer, question.matching_pairs);
  const rightOptions = question.matching_pairs.map((pair) => pair.right);

  function update(left: string, right: string) {
    const next = question.matching_pairs.map((pair) => ({
      left: pair.left,
      right: pair.left === left ? right : selected[pair.left] ?? "",
    }));
    onAnswer(JSON.stringify(next.filter((pair) => pair.right.trim())));
  }

  return (
    <div className="beta-question-stack">
      {question.matching_pairs.map((pair) => (
        <div className="matching-row" key={pair.left}>
          <div className="matching-prompt">
            <MarkdownContent content={pair.left} />
          </div>
          <select
            className="input matching-select"
            value={selected[pair.left] ?? ""}
            onChange={(event) => update(pair.left, event.target.value)}
          >
            <option value="">Choose a match</option>
            {rightOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function OrderingQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  const order = parseStringList(answer, question.ordering_items);

  function move(index: number, direction: -1 | 1) {
    const next = [...order];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onAnswer(JSON.stringify(next));
  }

  return (
    <div className="beta-question-stack">
      {order.map((item, itemIndex) => (
        <div className="ordering-row" key={`${item}-${itemIndex}`}>
          <span className="ordering-index">{itemIndex + 1}</span>
          <div className="ordering-item">
            <MarkdownContent content={item} />
          </div>
          <div className="ordering-controls">
            <Button variant="secondary" type="button" disabled={itemIndex === 0} onClick={() => move(itemIndex, -1)}>
              Up
            </Button>
            <Button variant="secondary" type="button" disabled={itemIndex === order.length - 1} onClick={() => move(itemIndex, 1)}>
              Down
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FillBlankQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  return (
    <div className="beta-question-stack">
      <input
        className="input"
        value={answer ?? ""}
        onChange={(event) => onAnswer(event.target.value)}
        placeholder="Type your answer here"
      />
      {question.expected_answer ? <p className="muted small">Case-insensitive matching is used for beta fill-in-the-blank questions.</p> : null}
    </div>
  );
}

function questionTypeLabel(question: Question): string {
  switch (question.type) {
    case "MCQ":
      return "Multiple choice";
    case "select_all":
      return "Select all that apply";
    case "matching":
      return "Matching";
    case "ordering":
      return "Ordering";
    case "fill_blank":
      return "Fill in the blank";
    default:
      return "Free response";
  }
}

function parseIndexList(answer?: string): number[] {
  if (!answer) return [];
  try {
    const parsed = JSON.parse(answer);
    return Array.isArray(parsed) ? parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : [];
  } catch {
    return [];
  }
}

function parseStringList(answer?: string, fallback: string[] = []): string[] {
  if (!answer) return [...fallback];
  try {
    const parsed = JSON.parse(answer);
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [...fallback];
  } catch {
    return [...fallback];
  }
}

function parseMatchingAnswer(answer: string | undefined, pairs: { left: string; right: string }[]): Record<string, string> {
  const initial: Record<string, string> = {};
  pairs.forEach((pair) => {
    initial[pair.left] = "";
  });
  if (!answer) return initial;
  try {
    const parsed = JSON.parse(answer);
    if (!Array.isArray(parsed)) return initial;
    parsed.forEach((entry) => {
      if (entry && typeof entry === "object") {
        const left = String((entry as { left?: unknown }).left ?? "");
        const right = String((entry as { right?: unknown }).right ?? "");
        if (left) initial[left] = right;
      }
    });
    return initial;
  } catch {
    return initial;
  }
}

function isQuestionAnswered(question: Question, answer?: string): boolean {
  if (!answer) return false;
  if (question.type === "select_all") {
    return parseIndexList(answer).length > 0;
  }
  if (question.type === "matching") {
    const selected = parseMatchingAnswer(answer, question.matching_pairs);
    return Object.values(selected).every((value) => value.trim().length > 0);
  }
  if (question.type === "ordering") {
    return parseStringList(answer, question.ordering_items).length === question.ordering_items.length;
  }
  return answer.trim().length > 0;
}
