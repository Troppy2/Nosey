import Editor from "@monaco-editor/react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  ExternalLink,
  Flag,
  Loader2,
  LogOut,
  PenLine,
  Play,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchLeetCodeProblem, gradeStage1, type Stage1SubmissionItem } from "../lib/api";
import { runPythonLeetCode, type RunnerResult } from "../lib/pyodideRunner";
import { isLeetCodeRunnable, sanitizeLeetCodeHtml } from "../lib/leetcodeHtml";
import {
  loadMockProgress,
  saveMockProgress,
  type MockProgress,
  type Stage1QuestionProgress,
} from "../lib/mockInterview";
import {
  COMPANY_OPTIONS,
  pickProblems,
  type CompanyKey,
  type InterviewProblem,
} from "../data/mockInterviewProblems";
import type { LeetCodeProblemData, MockInterviewSession } from "../lib/types";

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
  if (difficulty === "Hard") return "35 to 40 min";
  if (difficulty === "Easy") return "10 to 15 min";
  return "20 to 25 min";
}

function freshQuestion(p: InterviewProblem): Stage1QuestionProgress {
  return {
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    topics: p.topics,
    code: "",
    notes: "",
    timeUsedMs: 0,
    startedAt: 0,
    isExpired: false,
    ranOnce: false,
    lastTestsPassed: 0,
    lastTestsTotal: 0,
    lastAllPassed: false,
  };
}

export default function MockInterviewStage1() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const numericSessionId = Number(sessionId);
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as {
    session?: MockInterviewSession;
    selectedStages?: string[];
  } | null;

  // Resolve identity from navigation state first, then from any saved progress.
  const stored = useMemo<MockProgress | null>(
    () => (Number.isFinite(numericSessionId) ? loadMockProgress(numericSessionId) : null),
    [numericSessionId],
  );

  const company = (locationState?.session?.company ?? stored?.company ?? "random") as CompanyKey;
  const companyLabel = COMPANY_OPTIONS.find((c) => c.key === company)?.label ?? company;
  const selectedStages = locationState?.selectedStages ?? stored?.selectedStages ?? [
    "stage1",
    "stage2",
    "stage3",
  ];

  const missingContext = !locationState?.session && !stored;

  // Problems are chosen once and then frozen in localStorage so a refresh never
  // re-rolls the assessment.
  const [problems] = useState<InterviewProblem[]>(
    () => stored?.stage1?.problems ?? pickProblems(company, 3),
  );

  const [questions, setQuestions] = useState<Stage1QuestionProgress[]>(() => {
    if (stored?.stage1?.questions?.length === problems.length) {
      return stored.stage1.questions;
    }
    const initial = problems.map(freshQuestion);
    if (initial[0]) initial[0].startedAt = Date.now();
    return initial;
  });
  const [currentIdx, setCurrentIdx] = useState(() => stored?.stage1?.currentIdx ?? 0);

  // Fetched LeetCode problem statements + runner results, keyed by slug.
  const [problemData, setProblemData] = useState<Record<string, LeetCodeProblemData>>({});
  const [problemLoading, setProblemLoading] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [runnerResults, setRunnerResults] = useState<Record<string, RunnerResult>>({});
  const [running, setRunning] = useState(false);

  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  // If we landed here without any context, send the user back to setup.
  useEffect(() => {
    if (missingContext) navigate("/mock-interview", { replace: true });
  }, [missingContext, navigate]);

  // Make sure the active question's clock is running after a resume.
  useEffect(() => {
    setQuestions((prev) => {
      const cur = prev[currentIdx];
      if (!cur || cur.startedAt > 0 || cur.isExpired) return prev;
      const next = [...prev];
      next[currentIdx] = { ...cur, startedAt: Date.now() };
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Debounced persistence of the whole Stage 1 snapshot.
  useEffect(() => {
    if (missingContext) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const prev = loadMockProgress(numericSessionId);
      const progress: MockProgress = {
        ...(prev ?? {}),
        sessionId: numericSessionId,
        company,
        selectedStages,
        updatedAt: Date.now(),
        stage1: {
          problems,
          questions,
          currentIdx,
          submitted: prev?.stage1?.submitted ?? false,
          results: prev?.stage1?.results,
        },
      };
      saveMockProgress(progress);
    }, 500);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, currentIdx]);

  // Load the current problem statement on demand.
  const currentSlug = questions[currentIdx]?.slug;
  useEffect(() => {
    if (!currentSlug || problemData[currentSlug]) return;
    let cancelled = false;
    setProblemLoading(true);
    setProblemError(null);
    fetchLeetCodeProblem(currentSlug)
      .then((data) => {
        if (cancelled) return;
        setProblemData((prev) => ({ ...prev, [currentSlug]: data }));
        // Seed the editor with the official stub only if untouched.
        setQuestions((prev) => {
          const idx = prev.findIndex((q) => q.slug === currentSlug);
          if (idx < 0) return prev;
          if (prev[idx].code.trim() !== "") return prev;
          const snippet = (data.python_snippet ?? "").trimEnd();
          if (!snippet) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], code: `${snippet}\n` };
          return next;
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setProblemError(e instanceof Error ? e.message : "Could not load this problem.");
      })
      .finally(() => {
        if (!cancelled) setProblemLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlug]);

  const current = questions[currentIdx];
  const curData = current ? problemData[current.slug] : undefined;
  const curRunnable = isLeetCodeRunnable(curData);
  const limitMs = current ? questionTimeLimitMs(current.difficulty) : 0;
  const elapsedMs = current
    ? current.startedAt > 0
      ? current.timeUsedMs + (now - current.startedAt)
      : current.timeUsedMs
    : 0;
  const remainingMs = Math.max(0, limitMs - elapsedMs);
  const timePct = limitMs > 0 ? Math.max(0, Math.min(100, (remainingMs / limitMs) * 100)) : 0;
  const isWarning = remainingMs < 5 * 60 * 1000 && remainingMs > 0;
  const isExpiredNow = remainingMs === 0;
  const barColor = timePct > 40 ? "var(--green-dark)" : timePct > 20 ? "#f59e0b" : "#ef4444";

  useEffect(() => {
    if (isExpiredNow && current && !current.isExpired) {
      setQuestions((prev) => {
        const next = [...prev];
        next[currentIdx] = { ...next[currentIdx], isExpired: true, startedAt: 0, timeUsedMs: limitMs };
        return next;
      });
    }
  }, [isExpiredNow, current, currentIdx, limitMs]);

  function saveCurrentTime() {
    setQuestions((prev) => {
      const next = [...prev];
      const q = next[currentIdx];
      if (!q) return prev;
      const addedMs = q.startedAt > 0 ? Date.now() - q.startedAt : 0;
      next[currentIdx] = { ...q, timeUsedMs: q.timeUsedMs + addedMs, startedAt: 0 };
      return next;
    });
  }

  function goToQuestion(idx: number) {
    if (idx === currentIdx || idx < 0 || idx >= questions.length) return;
    saveCurrentTime();
    setCurrentIdx(idx);
    setQuestions((prev) => {
      const next = [...prev];
      const q = next[idx];
      if (q && !q.isExpired && q.startedAt === 0) next[idx] = { ...q, startedAt: Date.now() };
      return next;
    });
  }

  function handleCodeChange(val: string | undefined) {
    setQuestions((prev) => {
      const next = [...prev];
      next[currentIdx] = { ...next[currentIdx], code: val ?? "" };
      return next;
    });
  }

  function handleNotesChange(val: string) {
    setQuestions((prev) => {
      const next = [...prev];
      next[currentIdx] = { ...next[currentIdx], notes: val };
      return next;
    });
  }

  async function handleRun() {
    if (!current || !curData || !curRunnable || running) return;
    const cases = curData.examples.map((ex) => ({
      label: `Example ${ex.index}`,
      inputText: ex.input_text,
      expectedOutput: ex.output_text,
    }));
    setRunning(true);
    try {
      const result = await runPythonLeetCode(current.code, cases);
      setRunnerResults((prev) => ({ ...prev, [current.slug]: result }));
      const passed = result.cases?.filter((c) => c.passed).length ?? 0;
      const total = result.cases?.length ?? 0;
      setQuestions((prev) => {
        const next = [...prev];
        next[currentIdx] = {
          ...next[currentIdx],
          ranOnce: true,
          lastTestsPassed: passed,
          lastTestsTotal: total,
          lastAllPassed: result.ok && total > 0,
        };
        return next;
      });
    } catch (e: unknown) {
      setRunnerResults((prev) => ({
        ...prev,
        [current.slug]: {
          ok: false,
          output: "",
          error: e instanceof Error ? e.message : "Run failed.",
        },
      }));
    } finally {
      setRunning(false);
    }
  }

  async function handleSubmitAll() {
    saveCurrentTime();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const subs: Stage1SubmissionItem[] = questions.map((qs) => {
        const result = runnerResults[qs.slug];
        const testResults = result?.cases?.length
          ? JSON.stringify(
              result.cases.map((c) => ({
                label: c.label,
                passed: c.passed,
                actual: c.actual,
                expected: c.expected,
              })),
            )
          : "[]";
        return {
          slug: qs.slug,
          title: qs.title,
          difficulty: qs.difficulty,
          code: qs.code,
          time_used_ms: qs.timeUsedMs + (qs.startedAt > 0 ? Date.now() - qs.startedAt : 0),
          test_results: testResults,
          all_passed: qs.lastAllPassed,
          tests_passed: qs.lastTestsPassed,
          tests_total: qs.lastTestsTotal,
        };
      });
      const response = await gradeStage1(numericSessionId, subs);

      // Persist the graded results so the results page survives a refresh.
      const prev = loadMockProgress(numericSessionId);
      saveMockProgress({
        ...(prev ?? { sessionId: numericSessionId, company, selectedStages, updatedAt: Date.now() }),
        sessionId: numericSessionId,
        company,
        selectedStages,
        updatedAt: Date.now(),
        stage1: {
          problems,
          questions,
          currentIdx,
          submitted: true,
          results: response.results,
        },
      });

      setFinished(true);
      navigate(`/mock-interview/${sessionId}/stage1-results`, {
        state: { gradeResponse: response, session: locationState?.session, selectedStages, problems },
      });
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : "Grading failed. Try again.");
      setSubmitting(false);
    }
  }

  const attemptedCount = questions.filter(
    (qs) => qs.ranOnce || qs.code.trim().length > 60 || qs.isExpired,
  ).length;

  if (missingContext || !current) {
    return (
      <div className="mock-loading" style={{ height: "100vh" }}>
        <Loader2 size={20} className="spin" style={{ color: "var(--green-dark)" }} />
        <p className="muted">Loading your assessment…</p>
      </div>
    );
  }

  const curResult = runnerResults[current.slug];
  const curPassed = curResult?.cases?.filter((c) => c.passed).length ?? 0;
  const curTotal = curResult?.cases?.length ?? 0;

  return (
    <div className="mock-stage1-layout">
      {/* Topbar */}
      <div className="mock-stage1-topbar">
        <div className="mock-stage1-topbar-left">
          <div className="mock-stage1-company-badge">
            <Code2 size={11} />
            {companyLabel}
          </div>
          <span className="mock-stage1-stage-label">Stage 1: Online Assessment</span>
        </div>

        <div className="mock-stage1-question-tabs">
          {questions.map((qs, i) => {
            const attempted = qs.ranOnce || qs.code.trim().length > 60;
            return (
              <button
                key={qs.slug}
                className={[
                  "mock-q-tab",
                  i === currentIdx ? "active" : "",
                  qs.isExpired ? "expired" : "",
                  attempted ? "attempted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => goToQuestion(i)}
                title={qs.title}
              >
                <span className="mock-q-tab-dot" />
                Q{i + 1}
                <span
                  className={`pill mock-diff-${qs.difficulty.toLowerCase()}`}
                  style={{ fontSize: "0.68rem", padding: "1px 5px" }}
                >
                  {qs.difficulty[0]}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={`mock-stage1-timer${isWarning ? " warning" : ""}${isExpiredNow ? " expired" : ""}`}
        >
          <Clock size={13} />
          {isExpiredNow ? "Time's up" : formatMs(remainingMs)}
        </div>
      </div>

      {/* Main split */}
      <div className="mock-stage1-body">
        {/* Left: problem panel */}
        <div className="mock-stage1-problem-panel">
          <div className="mock-stage1-problem-header">
            <span className="mock-stage1-prob-num">
              Problem {currentIdx + 1} of {questions.length}
            </span>
            <h2 className="mock-stage1-problem-title">{current.title}</h2>
            <div className="mock-stage1-problem-meta">
              <span className={`pill mock-diff-${current.difficulty.toLowerCase()}`}>
                {current.difficulty}
              </span>
              {current.topics.map((t) => (
                <span key={t} className="pill">
                  {t}
                </span>
              ))}
            </div>
          </div>

          {current.isExpired && (
            <div className="mock-stage1-panel-section" style={{ paddingBottom: 10 }}>
              <div className="mock-stage1-expired-banner">
                <AlertCircle size={14} />
                Time expired. Submit what you have or move on.
              </div>
            </div>
          )}

          {/* Problem statement, rendered in-app */}
          <div className="mock-stage1-panel-section">
            <div className="mock-stage1-section-label-row">
              <span className="mock-stage1-section-label">Problem</span>
              <a
                href={`https://leetcode.com/problems/${current.slug}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="mock-stage1-lc-link"
              >
                LeetCode <ExternalLink size={10} />
              </a>
            </div>
            {problemLoading && (
              <div className="mock-stage1-statement-loading">
                <Loader2 size={15} className="spin" /> Loading problem…
              </div>
            )}
            {problemError && (
              <div className="mock-stage1-statement-error">
                <AlertCircle size={14} /> {problemError}
              </div>
            )}
            {curData && (
              <div
                className="mock-stage1-statement"
                dangerouslySetInnerHTML={{ __html: sanitizeLeetCodeHtml(curData.content_html) }}
              />
            )}
          </div>

          {/* Time budget */}
          <div className="mock-stage1-panel-section">
            <span className="mock-stage1-section-label">
              <Clock size={11} /> Time Budget
            </span>
            <div className="mock-stage1-time-budget">
              <div className="mock-stage1-time-budget-row">
                <span
                  className={`mock-stage1-time-budget-remaining${isWarning ? " warning" : ""}${
                    isExpiredNow ? " expired" : ""
                  }`}
                >
                  {isExpiredNow ? "Expired" : formatMs(remainingMs)}
                </span>
                <span className="mock-stage1-time-budget-limit">of {formatMsCompact(limitMs)}</span>
              </div>
              <div className="mock-stage1-time-bar-track">
                <div
                  className="mock-stage1-time-bar-fill"
                  style={{ width: `${timePct}%`, backgroundColor: barColor }}
                />
              </div>
              <div className="mock-stage1-benchmark-row">
                <Clock size={10} />
                Target: {benchmarkLabel(current.difficulty)}
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

        {/* Right: editor + run console */}
        <div className="mock-stage1-editor-panel">
          <div className="mock-stage1-editor-header">
            <span className="mock-stage1-editor-lang">
              <span className="mock-stage1-editor-lang-dot" />
              Python 3
            </span>
            <button
              className="mock-stage1-run-btn"
              onClick={handleRun}
              disabled={running || !curRunnable || !current.code.trim()}
              title={curRunnable ? "Run against the sample cases" : "This problem cannot be run in-app"}
            >
              {running ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
              {running ? "Running…" : "Run"}
            </button>
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

          {/* Run console */}
          {!curRunnable && curData && (
            <div className="mock-stage1-console mock-stage1-console--note">
              This problem has no auto-runnable harness. Write your solution and submit; it will be
              reviewed without sample execution.
            </div>
          )}
          {curResult && (
            <div className="mock-stage1-console">
              {curResult.error ? (
                <div className="mock-stage1-console-error">
                  <AlertCircle size={13} /> {curResult.error}
                </div>
              ) : (
                <>
                  <div className="mock-stage1-console-summary">
                    {curResult.ok ? (
                      <span className="mock-stage1-console-pass">
                        <CheckCircle2 size={14} /> Passed {curPassed}/{curTotal} sample cases
                      </span>
                    ) : (
                      <span className="mock-stage1-console-fail">
                        <XCircle size={14} /> Passed {curPassed}/{curTotal} sample cases
                      </span>
                    )}
                  </div>
                  {curResult.cases?.some((c) => !c.passed) && (
                    <details className="mock-stage1-console-details">
                      <summary>View failing cases</summary>
                      {curResult.cases
                        .filter((c) => !c.passed)
                        .map((c, i) => (
                          <div key={i} className="mock-stage1-console-case">
                            <span className="mock-stage1-console-case-label">{c.label}</span>
                            <div>
                              <span className="muted small">Expected:</span> <code>{c.expected}</code>
                            </div>
                            <div>
                              <span className="muted small">Got:</span> <code>{c.actual}</code>
                            </div>
                          </div>
                        ))}
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="mock-stage1-bottombar">
        <button
          className="button button-ghost"
          style={{ padding: "6px 10px" }}
          onClick={() => goToQuestion(currentIdx - 1)}
          disabled={currentIdx === 0}
          title="Previous problem"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="button button-ghost"
          style={{ padding: "6px 10px" }}
          onClick={() => goToQuestion(currentIdx + 1)}
          disabled={currentIdx === questions.length - 1}
          title="Next problem"
        >
          <ChevronRight size={15} />
        </button>

        <div className="mock-stage1-q-status-row">
          {questions.map((qs, i) => {
            const attempted = qs.ranOnce || qs.code.trim().length > 60;
            return (
              <button
                key={qs.slug}
                className={[
                  "mock-stage1-q-chip",
                  i === currentIdx ? "active" : "",
                  qs.isExpired ? "expired" : "",
                  attempted && !qs.isExpired ? "attempted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => goToQuestion(i)}
                title={qs.title}
              >
                <span className="mock-stage1-q-chip-dot" />
                Q{i + 1}
              </button>
            );
          })}
        </div>

        <span className="mock-stage1-q-progress">
          {attemptedCount}/{questions.length} attempted
        </span>

        <div style={{ flex: 1 }} />

        {submitError && (
          <span className="mock-stage1-submit-error">
            <AlertCircle size={13} /> {submitError}
          </span>
        )}

        <button
          className="button button-ghost"
          style={{ padding: "8px 14px" }}
          onClick={() => navigate("/mock-interview")}
          disabled={submitting}
          title="Quit (your progress is saved)"
        >
          <LogOut size={13} /> Quit
        </button>
        <button
          className="button button-primary"
          style={{ padding: "8px 20px" }}
          onClick={handleSubmitAll}
          disabled={submitting || finished}
        >
          {submitting ? (
            <>
              <Loader2 size={14} className="spin" /> Grading…
            </>
          ) : (
            <>
              <Flag size={13} /> Submit All
            </>
          )}
        </button>
      </div>
    </div>
  );
}
