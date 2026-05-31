import { AlertCircle, CheckCircle2, Loader2, Minus, RefreshCw, Trophy, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { finishMockInterview } from "../lib/api";
import type { MockInterviewFinishResponse, MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";

const RECOMMENDATION_META: Record<
  string,
  { label: string; className: string; icon: React.ElementType; description: string }
> = {
  "STRONG HIRE": {
    label: "Strong Hire",
    className: "rec-strong-hire",
    icon: CheckCircle2,
    description: "Exceptional performance across all stages.",
  },
  HIRE: {
    label: "Hire",
    className: "rec-hire",
    icon: CheckCircle2,
    description: "Solid performance. Ready for the role.",
  },
  BORDERLINE: {
    label: "Borderline",
    className: "rec-borderline",
    icon: Minus,
    description: "Mixed performance. More practice needed.",
  },
  "NO HIRE": {
    label: "No Hire",
    className: "rec-no-hire",
    icon: XCircle,
    description: "Significant gaps identified. Keep practicing.",
  },
};

const VERDICT_LABELS: Record<string, { label: string; className: string }> = {
  strong:     { label: "Strong Pass", className: "verdict-strong" },
  pass:       { label: "Pass",        className: "verdict-pass" },
  borderline: { label: "Borderline",  className: "verdict-borderline" },
  needs_work: { label: "Needs Work",  className: "verdict-needs-work" },
};

export default function MockInterviewSummary() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    session: MockInterviewSession;
    selectedStages: string[];
  } | null;

  const session = state?.session;
  const company = (session?.company ?? "random") as CompanyKey;
  const companyLabel = COMPANY_OPTIONS.find((c) => c.key === company)?.label ?? company;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<MockInterviewFinishResponse | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await finishMockInterview(Number(sessionId));
        setResult(data);
      } catch (e: unknown) {
        setLoadError(e instanceof Error ? e.message : "Failed to generate summary.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="page page-narrow mock-loading">
        <Trophy size={32} style={{ color: "var(--green-dark)" }} />
        <p className="muted">Generating your interview debrief…</p>
        <Loader2 size={22} className="spin" style={{ marginTop: 4, color: "var(--green-dark)" }} />
      </div>
    );
  }

  if (loadError || !result) {
    return (
      <div className="page page-narrow">
        <div className="card mock-error-card">
          <AlertCircle size={20} style={{ color: "var(--error)" }} />
          <p>{loadError ?? "Could not generate summary."}</p>
          <button className="button button-ghost" onClick={() => navigate("/mock-interview")}>
            Back to Setup
          </button>
        </div>
      </div>
    );
  }

  const recMeta = RECOMMENDATION_META[result.hiring_recommendation] ?? RECOMMENDATION_META.BORDERLINE;
  const RecIcon = recMeta.icon;

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <div>
          <span className="eyebrow">Interview Complete</span>
          <h1 style={{ marginTop: 6 }}>Loop Debrief</h1>
          <p className="muted small" style={{ marginTop: 6 }}>{companyLabel} , Full Interview Loop</p>
        </div>
        <Trophy size={26} style={{ color: "var(--green-dark)", flexShrink: 0, marginTop: 4 }} />
      </div>

      {/* Hiring recommendation hero */}
      <div className={`card mock-rec-card ${recMeta.className}`}>
        <RecIcon size={44} className="mock-rec-icon" />
        <div style={{ flex: 1 }}>
          <div className="mock-rec-label">{recMeta.label}</div>
          <div className="muted small" style={{ marginTop: 4 }}>{recMeta.description}</div>
        </div>
      </div>

      {/* Per-stage verdicts */}
      <div className="mock-summary-stages">
        {result.stage1_verdict && (
          <StageVerdictChip stage="Stage 1 , Online Assessment" verdict={result.stage1_verdict} />
        )}
        {result.stage2_verdict && (
          <StageVerdictChip stage="Stage 2 , Technical Interview" verdict={result.stage2_verdict} />
        )}
        {result.stage3_verdict && (
          <StageVerdictChip stage="Stage 3 , Behavioral" verdict={result.stage3_verdict} />
        )}
      </div>

      {/* Overall feedback */}
      <div className="card mock-summary-feedback">
        <span className="eyebrow">Recruiter Debrief</span>
        <p className="muted">{result.overall_feedback}</p>
      </div>

      {/* Actions */}
      <div className="button-row" style={{ marginTop: 28 }}>
        <button className="button button-ghost" onClick={() => navigate("/dashboard")}>
          Dashboard
        </button>
        <button
          className="button button-primary"
          onClick={() => navigate("/mock-interview")}
        >
          <RefreshCw size={14} /> Try Again
        </button>
      </div>
    </div>
  );
}

function StageVerdictChip({ stage, verdict }: { stage: string; verdict: string }) {
  const meta = VERDICT_LABELS[verdict] ?? VERDICT_LABELS.borderline;
  return (
    <div className="mock-stage-verdict-chip">
      <span className="mock-stage-verdict-chip-name">{stage}</span>
      <span className={`mock-verdict-badge ${meta.className}`}>{meta.label}</span>
    </div>
  );
}
