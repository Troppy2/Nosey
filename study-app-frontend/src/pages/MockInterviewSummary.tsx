import { AlertCircle, RefreshCw, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { LoadingNotice } from "../components/Loaders";
import { finishMockInterview } from "../lib/api";
import type { MockInterviewFinishResponse, MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { clearActiveMockSession, type MockProgress } from "../lib/mockInterview";
import { MockProgressGate } from "../components/MockProgressGate";
import { LoopStation } from "../components/MockLoopRail";
import { LOOP_STAGES, recommendationMeta, verdictMeta } from "../data/mockInterviewLoop";

export default function MockInterviewSummary() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <MockProgressGate
      sessionId={Number(sessionId)}
      label="Loading your summary"
      render={(stored) => <SummaryView stored={stored} />}
    />
  );
}

function SummaryView({ stored }: { stored: MockProgress | null }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const numericSessionId = Number(sessionId);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { session?: MockInterviewSession; selectedStages?: string[] } | null;

  const rawCompany = state?.session?.company ?? stored?.company ?? "random";
  const company = (rawCompany === "custom" ? "random" : rawCompany) as CompanyKey;
  const companyLabel =
    rawCompany === "custom"
      ? state?.session?.custom_company ?? stored?.customCompany ?? "Custom"
      : COMPANY_OPTIONS.find((c) => c.key === company)?.label ?? company;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<MockInterviewFinishResponse | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const data = await finishMockInterview(numericSessionId);
        if (cancelled) return;
        setResult(data);
        // Loop is finished: drop the resume pointer so setup no longer offers it.
        clearActiveMockSession();
      } catch (e: unknown) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to generate summary.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numericSessionId, attempt]);

  if (loading) {
    return (
      <div className="page page-narrow mock-loading">
        <Trophy size={32} style={{ color: "var(--green-dark)" }} />
        <LoadingNotice
          title="Writing your interview debrief"
          estimate="Pulling together every stage you completed. Around 20 seconds."
          slowNote="Still writing. A full three-stage debrief takes the longest. Keep this page open."
          slowAfterMs={25000}
        />
      </div>
    );
  }

  if (loadError || !result) {
    return (
      <div className="page page-narrow">
        <div className="card mock-error-card">
          <AlertCircle size={20} style={{ color: "var(--error)" }} />
          <p>{loadError ?? "Could not generate summary."}</p>
          <div className="button-row" style={{ marginTop: 8 }}>
            <button className="button button-ghost" onClick={() => navigate("/mock-interview")}>
              Back to Setup
            </button>
            <button className="button button-primary" onClick={() => setAttempt((a) => a + 1)}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const recMeta = recommendationMeta(result.hiring_recommendation);
  const RecIcon = recMeta.icon;
  const graded = LOOP_STAGES.filter((stage) => result[stage.verdictKey]);

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <div>
          <span className="eyebrow">Interview Complete</span>
          <h1 style={{ marginTop: 6 }}>Loop Debrief</h1>
          <p className="muted small" style={{ marginTop: 6 }}>
            {companyLabel}: Full Interview Loop
          </p>
        </div>
        <Trophy size={26} style={{ color: "var(--green-dark)", flexShrink: 0, marginTop: 4 }} />
      </div>

      <div className={`card mock-rec-card ${recMeta.className}`}>
        <RecIcon size={44} className="mock-rec-icon" />
        <div style={{ flex: 1 }}>
          <div className="mock-rec-label">{recMeta.label}</div>
          <div className="muted small" style={{ marginTop: 4 }}>
            {recMeta.description}
          </div>
        </div>
      </div>

      {/* The same spine from setup, now carrying a verdict at every station you ran. */}
      <ol className="loop-spine loop-spine--verdicts" aria-label="Verdict by stage">
        {graded.map((stage, i) => {
          const meta = verdictMeta(result[stage.verdictKey]);
          return (
            <LoopStation
              key={stage.key}
              icon={stage.icon}
              index={i + 1}
              label={stage.label}
              className={`loop-${meta.className}`}
              trailing={<span className={`mock-verdict-badge ${meta.className}`}>{meta.label}</span>}
            />
          );
        })}
      </ol>

      <div className="card mock-summary-feedback">
        <span className="eyebrow">Recruiter Debrief</span>
        <p className="muted">{result.overall_feedback}</p>
      </div>

      <div className="button-row" style={{ marginTop: 28 }}>
        <button className="button button-ghost" onClick={() => navigate("/dashboard")}>
          Dashboard
        </button>
        <button className="button button-primary" onClick={() => navigate("/mock-interview")}>
          <RefreshCw size={14} /> Try Again
        </button>
      </div>
    </div>
  );
}
