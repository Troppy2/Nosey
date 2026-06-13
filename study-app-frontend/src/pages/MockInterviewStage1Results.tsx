import { CheckCircle2, ChevronRight, Clock, Minus, XCircle } from "lucide-react";
import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { MockInterviewSession, Stage1GradeResponse, Stage1QuestionResult } from "../lib/types";
import { loadMockProgress } from "../lib/mockInterview";

function formatMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

const VERDICT_META: Record<
  string,
  { label: string; className: string; icon: React.ElementType; color: string }
> = {
  strong: { label: "Strong Pass", className: "verdict-strong", icon: CheckCircle2, color: "#10b981" },
  pass: { label: "Pass", className: "verdict-pass", icon: CheckCircle2, color: "#3b82f6" },
  borderline: { label: "Borderline", className: "verdict-borderline", icon: Minus, color: "#f59e0b" },
  needs_work: { label: "Needs Work", className: "verdict-needs-work", icon: XCircle, color: "#ef4444" },
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const meta = VERDICT_META[verdict] ?? VERDICT_META.borderline;
  const Icon = meta.icon;
  return (
    <span className={`mock-verdict-badge ${meta.className}`}>
      <Icon size={12} />
      {meta.label}
    </span>
  );
}

function overallVerdict(results: Stage1QuestionResult[]): string {
  const verdicts = results.map((r) => r.verdict);
  if (verdicts.length === 0) return "borderline";
  if (verdicts.every((v) => v === "strong")) return "strong";
  if (verdicts.filter((v) => v === "strong" || v === "pass").length >= Math.ceil(verdicts.length / 2))
    return "pass";
  if (verdicts.some((v) => v === "borderline")) return "borderline";
  return "needs_work";
}

export default function MockInterviewStage1Results() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const numericSessionId = Number(sessionId);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    gradeResponse?: Stage1GradeResponse;
    session?: MockInterviewSession;
    selectedStages?: string[];
  } | null;

  // Prefer navigation state, fall back to the persisted snapshot on refresh.
  const stored = useMemo(
    () => (Number.isFinite(numericSessionId) ? loadMockProgress(numericSessionId) : null),
    [numericSessionId],
  );

  const results = state?.gradeResponse?.results ?? stored?.stage1?.results ?? null;
  const selectedStages = state?.selectedStages ?? stored?.selectedStages ?? ["stage1"];

  if (!results) {
    navigate("/mock-interview", { replace: true });
    return null;
  }

  const overall = overallVerdict(results);
  const overallMeta = VERDICT_META[overall] ?? VERDICT_META.borderline;
  const OverallIcon = overallMeta.icon;
  const passedCount = results.filter((r) => r.verdict === "strong" || r.verdict === "pass").length;

  const hasLaterStage = selectedStages.includes("stage2") || selectedStages.includes("stage3");

  function nextRoute() {
    if (selectedStages.includes("stage2")) return `/mock-interview/${sessionId}/stage2`;
    if (selectedStages.includes("stage3")) return `/mock-interview/${sessionId}/stage3`;
    return `/mock-interview/${sessionId}/summary`;
  }

  return (
    <div className="page page-narrow">
      <div className="mock-results-page-header">
        <span className="eyebrow">Stage 1 Complete</span>
        <h1 style={{ marginTop: 6 }}>Online Assessment Results</h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          Here is how you performed on each problem.
        </p>
      </div>

      <div className={`card mock-overall-card mock-overall-${overall}`}>
        <OverallIcon size={36} className="mock-overall-icon" style={{ color: overallMeta.color }} />
        <div style={{ flex: 1 }}>
          <div className="mock-overall-label">{overallMeta.label}</div>
          <div className="muted small" style={{ marginTop: 2 }}>
            {passedCount} of {results.length} problems passed
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="mock-score-fraction" style={{ color: overallMeta.color }}>
            {passedCount}
            <span style={{ fontSize: "1.1rem", color: "var(--muted)" }}>/{results.length}</span>
          </div>
          <div className="mock-score-label">problems</div>
        </div>
      </div>

      <div className="mock-results-list">
        {results.map((result, i) => (
          <div key={result.slug} className={`card mock-result-card ${result.verdict}`}>
            <div className="mock-result-header">
              <span className="mock-result-num">Q{i + 1}</span>
              <span className="mock-result-title">{result.title}</span>
              <span className={`pill mock-diff-${result.difficulty.toLowerCase()}`}>
                {result.difficulty}
              </span>
              <VerdictBadge verdict={result.verdict} />
              <span className="muted small mock-result-time">
                <Clock size={11} />
                {formatMs(result.time_used_ms)}
              </span>
            </div>
            <p className="mock-result-feedback">{result.feedback}</p>
            {result.code.trim().length > 0 && (
              <details className="mock-result-code-toggle">
                <summary>View your code</summary>
                <pre className="mock-result-code">{result.code}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="button-row" style={{ marginTop: 28 }}>
        <button className="button button-ghost" onClick={() => navigate("/mock-interview")}>
          Exit Interview
        </button>
        <button
          className="button button-primary"
          onClick={() => navigate(nextRoute(), { state: { session: state?.session, selectedStages } })}
        >
          {hasLaterStage ? "Continue to Next Stage" : "View Final Summary"}
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
