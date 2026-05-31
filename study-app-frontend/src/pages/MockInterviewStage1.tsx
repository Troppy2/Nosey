import Editor from "@monaco-editor/react";
import { AlertCircle, ChevronLeft, ChevronRight, Clock, Code2, ExternalLink, Flag, Loader2, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { gradeStage1, type Stage1SubmissionItem } from "../lib/api";
import { COMPANY_OPTIONS, pickProblems, type CompanyKey, type InterviewProblem } from "../data/mockInterviewProblems";
import type { MockInterviewSession } from "../lib/types";

function questionTimeLimitMs(difficulty: string): number {
  if (difficulty === "Hard") return 40 * 60 * 1000;
  if (difficulty === "Easy") return 15 * 60 * 1000;
  return 25 * 60 * 1000;
}

function formatMs(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatMsCompact(ms: number): string {
  const totalMin = Math.ceil(ms / 60000);
  return `${totalMin} min`;
}

function benchmarkLabel(difficulty: string): string {
  if (difficulty === "Hard") return "35–40 min";
  if (difficulty === "Easy") return "10–15 min";
  return "20–25 min";
}

type QuestionState = {
  problem: InterviewProblem;
  code: string;
  notes: string;
  startedAt: number;
  timeUsedMs: number;
  isExpired: boolean;
  skipped: boolean;
};

export default function MockInterviewStage1() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as {
    session: MockInterviewSession;
    selectedStages: string[];
  } | null;

  const session = locationState?.session;
  const selectedStages = locationState?.selectedStages ?? ["stage1", "stage2", "stage3"];
  const company = (session?.company ?? "random") as CompanyKey;
  const companyLabel = COMPANY_OPTIONS.find((c) => c.key === company)?.label ?? company;

  const [problems] = useState<InterviewProblem[]>(() => pickProblems(company, 3));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [questionStates, setQuestionStates] = useState<QuestionState[]>(() =>
    problems.map((p) => ({
      problem: p,
      code: `# ${p.title}\n# Write your solution here\n\n`,
      notes: "",
      startedAt: 0,
      timeUsedMs: 0,
      isExpired: false,
      skipped: false,
    }))
  );

  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  useEffect(() => {
    setQuestionStates((prev) => {
      const next = [...prev];
      next[0] = { ...next[0], startedAt: Date.now() };
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = questionStates[currentIdx];
  const limitMs = questionTimeLimitMs(current.problem.difficulty);
  const elapsedMs = current.startedAt > 0
    ? current.timeUsedMs + (now - current.startedAt)
    : current.timeUsedMs;
  const remainingMs = Math.max(0, limitMs - elapsedMs);
  const timePct = Math.max(0, Math.min(100, (remainingMs / limitMs) * 100));
  const isWarning = remainingMs < 5 * 60 * 1000 && remainingMs > 0;
  const isExpiredNow = remainingMs === 0;

  const barColor = timePct > 40 ? "var(--green-dark)" : timePct > 20 ? "#f59e0b" : "#ef4444";

  useEffect(() => {
    if (isExpiredNow && !current.isExpired) {
      setQuestionStates((prev) => {
        const next = [...prev];
        next[currentIdx] = { ...next[currentIdx], isExpired: true };
        return next;
      });
    }
  }, [isExpiredNow, current.isExpired, currentIdx]);

  function saveCurrentCodeAndTime() {
    setQuestionStates((prev) => {
      const next = [...prev];
      const q = next[currentIdx];
      const addedMs = q.startedAt > 0 ? Date.now() - q.startedAt : 0;
      next[currentIdx] = { ...q, timeUsedMs: q.timeUsedMs + addedMs, startedAt: 0 };
      return next;
    });
  }

  function goToQuestion(idx: number) {
    if (idx === currentIdx) return;
    saveCurrentCodeAndTime();
    setCurrentIdx(idx);
    setQuestionStates((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], startedAt: Date.now() };
      return next;
    });
  }

  function handleCodeChange(val: string | undefined) {
    setQuestionStates((prev) => {
      const next = [...prev];
      next[currentIdx] = { ...next[currentIdx], code: val ?? "" };
      return next;
    });
  }

  function handleNotesChange(val: string) {
    setQuestionStates((prev) => {
      const next = [...prev];
      next[currentIdx] = { ...next[currentIdx], notes: val };
      return next;
    });
  }

  async function handleSubmitAll() {
    saveCurrentCodeAndTime();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const subs: Stage1SubmissionItem[] = questionStates.map((qs) => ({
        slug: qs.problem.slug,
        title: qs.problem.title,
        difficulty: qs.problem.difficulty,
        code: qs.code,
        time_used_ms: qs.timeUsedMs + (qs.startedAt > 0 ? Date.now() - qs.startedAt : 0),
        test_results: "[]",
        all_passed: false,
      }));
      const response = await gradeStage1(Number(sessionId), subs);
      setFinished(true);
      navigate(`/mock-interview/${sessionId}/stage1-results`, {
        state: { gradeResponse: response, session, selectedStages, problems },
      });
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Grading failed. Try again.");
      setSubmitting(false);
    }
  }

  const attemptedCount = questionStates.filter(
    (qs) => qs.code.trim().length > 50 || qs.skipped || qs.isExpired
  ).length;

  return (
    <div className="mock-stage1-layout">
      {/* ── Topbar ── */}
      <div className="mock-stage1-topbar">
        <div className="mock-stage1-topbar-left">
          <div className="mock-stage1-company-badge">
            <Code2 size={11} />
            {companyLabel}
          </div>
          <span className="mock-stage1-stage-label">Stage 1 , OA</span>
        </div>

        <div className="mock-stage1-question-tabs">
          {questionStates.map((qs, i) => {
            const attempted = qs.code.trim().length > 50 || qs.skipped;
            return (
              <button
                key={i}
                className={[
                  "mock-q-tab",
                  i === currentIdx ? "active" : "",
                  qs.isExpired ? "expired" : "",
                  attempted ? "attempted" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => goToQuestion(i)}
                title={qs.problem.title}
              >
                <span className="mock-q-tab-dot" />
                Q{i + 1}
                <span className={`pill mock-diff-${qs.problem.difficulty.toLowerCase()}`} style={{ fontSize: "0.68rem", padding: "1px 5px" }}>
                  {qs.problem.difficulty[0]}
                </span>
              </button>
            );
          })}
        </div>

        <div className={`mock-stage1-timer${isWarning ? " warning" : ""}${isExpiredNow ? " expired" : ""}`}>
          <Clock size={13} />
          {isExpiredNow ? "Time's up" : formatMs(remainingMs)}
        </div>
      </div>

      {/* ── Main split ── */}
      <div className="mock-stage1-body">
        {/* Left: problem panel */}
        <div className="mock-stage1-problem-panel">

          {/* Header: problem number + title + chips */}
          <div className="mock-stage1-problem-header">
            <span className="mock-stage1-prob-num">
              Problem {currentIdx + 1} of {questionStates.length}
            </span>
            <h2 className="mock-stage1-problem-title">{current.problem.title}</h2>
            <div className="mock-stage1-problem-meta">
              <span className={`pill mock-diff-${current.problem.difficulty.toLowerCase()}`}>
                {current.problem.difficulty}
              </span>
              {current.problem.topics.map((t) => (
                <span key={t} className="pill">{t}</span>
              ))}
            </div>
          </div>

          {/* Expired banner */}
          {current.isExpired && (
            <div className="mock-stage1-panel-section" style={{ paddingBottom: 10 }}>
              <div className="mock-stage1-expired-banner">
                <AlertCircle size={14} />
                Time expired , submit what you have or move on.
              </div>
            </div>
          )}

          {/* Description section */}
          <div className="mock-stage1-panel-section">
            <span className="mock-stage1-section-label">Description</span>
            <div className="mock-stage1-lc-card">
              <span className="mock-stage1-lc-card-text">
                Read the full problem on LeetCode, then solve it here.
              </span>
              <a
                href={`https://leetcode.com/problems/${current.problem.slug}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="mock-stage1-lc-link"
              >
                Open <ExternalLink size={10} />
              </a>
            </div>
          </div>

          {/* Topics */}
          <div className="mock-stage1-panel-section">
            <span className="mock-stage1-section-label">Topics</span>
            <div className="mock-stage1-topics-chips">
              {current.problem.topics.map((t) => (
                <span key={t} className="pill">{t}</span>
              ))}
            </div>
          </div>

          {/* Time budget */}
          <div className="mock-stage1-panel-section">
            <span className="mock-stage1-section-label">
              <Clock size={11} /> Time Budget
            </span>
            <div className="mock-stage1-time-budget">
              <div className="mock-stage1-time-budget-row">
                <span
                  className={`mock-stage1-time-budget-remaining${isWarning ? " warning" : ""}${isExpiredNow ? " expired" : ""}`}
                >
                  {isExpiredNow ? "Expired" : formatMs(remainingMs)}
                </span>
                <span className="mock-stage1-time-budget-limit">
                  of {formatMsCompact(limitMs)}
                </span>
              </div>
              <div className="mock-stage1-time-bar-track">
                <div
                  className="mock-stage1-time-bar-fill"
                  style={{ width: `${timePct}%`, backgroundColor: barColor }}
                />
              </div>
              <div className="mock-stage1-benchmark-row">
                <Clock size={10} />
                Target: {benchmarkLabel(current.problem.difficulty)}
              </div>
            </div>
          </div>

          {/* Scratch pad */}
          <div className="mock-stage1-scratch-section">
            <span className="mock-stage1-section-label">
              <PenLine size={11} /> Scratch Pad
            </span>
            <textarea
              className="mock-stage1-scratch-input"
              placeholder="Jot down your approach, edge cases, pseudocode…"
              value={current.notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>

        {/* Right: Monaco editor */}
        <div className="mock-stage1-editor-panel">
          <div className="mock-stage1-editor-header">
            <span className="mock-stage1-editor-lang">
              <span className="mock-stage1-editor-lang-dot" />
              Python 3
            </span>
            <span className="mock-stage1-editor-hint">Shift+Enter for new line</span>
          </div>
          <div className="mock-stage1-editor-wrap">
            <Editor
              height="100%"
              language="python"
              theme="vs-dark"
              value={current.code}
              onChange={handleCodeChange}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                lineNumbers: "on",
                folding: false,
                suggestOnTriggerCharacters: false,
                quickSuggestions: false,
                parameterHints: { enabled: false },
                renderLineHighlight: "line",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div className="mock-stage1-bottombar">
        {/* Prev / Next */}
        <button
          className="button button-ghost"
          style={{ padding: "6px 10px" }}
          onClick={() => goToQuestion(Math.max(0, currentIdx - 1))}
          disabled={currentIdx === 0}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="button button-ghost"
          style={{ padding: "6px 10px" }}
          onClick={() => goToQuestion(Math.min(questionStates.length - 1, currentIdx + 1))}
          disabled={currentIdx === questionStates.length - 1}
        >
          <ChevronRight size={15} />
        </button>

        {/* Question chips */}
        <div className="mock-stage1-q-status-row">
          {questionStates.map((qs, i) => {
            const attempted = qs.code.trim().length > 50 || qs.skipped;
            return (
              <button
                key={i}
                className={[
                  "mock-stage1-q-chip",
                  i === currentIdx ? "active" : "",
                  qs.isExpired ? "expired" : "",
                  attempted && !qs.isExpired ? "attempted" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => goToQuestion(i)}
                title={qs.problem.title}
              >
                <span className="mock-stage1-q-chip-dot" />
                Q{i + 1}
              </button>
            );
          })}
        </div>

        <span className="mock-stage1-q-progress">
          {attemptedCount}/{questionStates.length} attempted
        </span>

        <div style={{ flex: 1 }} />

        {submitError && (
          <span className="mock-stage1-submit-error">
            <AlertCircle size={13} /> {submitError}
          </span>
        )}

        <button
          className="button button-primary"
          style={{ padding: "8px 20px" }}
          onClick={handleSubmitAll}
          disabled={submitting || finished}
        >
          {submitting ? (
            <><Loader2 size={14} className="spin" /> Grading…</>
          ) : (
            <><Flag size={13} /> Submit All</>
          )}
        </button>
      </div>
    </div>
  );
}
