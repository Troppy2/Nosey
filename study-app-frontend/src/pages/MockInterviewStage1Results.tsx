import { ChevronRightIcon } from "../icons";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { MockInterviewSession, Stage1GradeResponse, Stage1QuestionResult } from "../lib/types";
import type { MockProgress } from "../lib/mockInterview";
import { MockProgressGate } from "../components/MockProgressGate";
import { MockLoopTrack } from "../components/MockLoopRail";
import { verdictMeta } from "../data/mockInterviewLoop";
import { MarkdownContent } from "../components/MarkdownContent";
import "../styles/components/mock-debrief.css";

function formatMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
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
  return (
    <MockProgressGate
      sessionId={Number(sessionId)}
      label="Loading your results"
      render={(stored) => <Stage1ResultsView stored={stored} />}
    />
  );
}

// Prefers navigation state, falls back to the persisted snapshot on refresh.
function Stage1ResultsView({ stored }: { stored: MockProgress | null }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const numericSessionId = Number(sessionId);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    gradeResponse?: Stage1GradeResponse;
    session?: MockInterviewSession;
    selectedStages?: string[];
  } | null;

  const results = state?.gradeResponse?.results ?? stored?.stage1?.results ?? null;
  const selectedStages = state?.selectedStages ?? stored?.selectedStages ?? ["stage1"];

  if (!results) {
    navigate("/mock-interview", { replace: true });
    return null;
  }

  const overall = overallVerdict(results);
  const overallMeta = verdictMeta(overall);
  const passedCount = results.filter((r) => r.verdict === "strong" || r.verdict === "pass").length;

  const hasLaterStage = selectedStages.includes("stage2") || selectedStages.includes("stage3");

  function nextRoute() {
    if (selectedStages.includes("stage2")) return `/mock-interview/${sessionId}/stage2`;
    if (selectedStages.includes("stage3")) return `/mock-interview/${sessionId}/stage3`;
    return `/mock-interview/${sessionId}/summary`;
  }

  return (
    <div className="debrief">
      <header className="debrief-head">
        <span className="debrief-kicker">
          Online assessment, {passedCount} of {results.length} problems passed
        </span>
        <h1 className="debrief-word">{overallMeta.label}</h1>
        <MockLoopTrack stages={selectedStages} current="stage1" />
      </header>

      <section className="debrief-rows" aria-label="Results by problem">
        {results.map((result) => {
          const meta = verdictMeta(result.verdict);
          return (
            <div key={result.slug} className="debrief-row">
              <div className="debrief-row-side">
                <h2>{result.title.startsWith("custom-") ? "Custom problem" : result.title}</h2>
                <span className={`debrief-verdict ${toneOf(result.verdict)}`}>{meta.label}</span>
                <span className="debrief-meta">
                  {result.difficulty}, {formatMs(result.time_used_ms)}
                </span>
                <span className="debrief-meta">
                  {result.hidden_total
                    ? `${result.hidden_passed ?? 0} of ${result.hidden_total} hidden tests`
                    : "Graded on samples"}
                </span>
              </div>
              <div className="debrief-body">
                <MarkdownContent content={result.feedback} />
                {result.hidden_failures && result.hidden_failures.length > 0 && (
                  <details className="debrief-code">
                    <summary>Failed hidden tests ({result.hidden_failures.length})</summary>
                    {result.hidden_failures.map((f, i) => (
                      <pre key={i}>{`Input: ${f.input}
Expected: ${f.expected}
Got: ${f.actual}`}</pre>
                    ))}
                  </details>
                )}
                {result.code.trim().length > 0 && (
                  <details className="debrief-code">
                    <summary>View your code</summary>
                    <pre>{result.code}</pre>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <div className="debrief-actions">
        <button
          type="button"
          className="debrief-btn debrief-btn-primary"
          onClick={() => navigate(nextRoute(), { state: { session: state?.session, selectedStages } })}
        >
          {hasLaterStage ? "Continue to next round" : "View the debrief"}
          <ChevronRightIcon size={15} />
        </button>
        <button type="button" className="debrief-btn" onClick={() => navigate("/mock-interview")}>
          Exit interview
        </button>
      </div>
    </div>
  );
}

function toneOf(verdict?: string | null): string {
  if (verdict === "strong" || verdict === "pass") return "debrief-tone-good";
  if (verdict === "needs_work") return "debrief-tone-bad";
  return "debrief-tone-mid";
}
