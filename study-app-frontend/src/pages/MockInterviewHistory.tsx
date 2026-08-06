import { AlertCircle, ArrowLeft, Briefcase, ChevronRight, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingNotice } from "../components/Loaders";
import { listMockInterviewSessions } from "../lib/api";
import type { MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { MockLoopTrack } from "../components/MockLoopRail";
import { RECOMMENDATIONS, recommendationMeta } from "../data/mockInterviewLoop";

const LEVEL_LABELS: Record<string, string> = {
  intern: "Internship",
  junior: "New grad / Junior",
  mid: "Mid-level",
  senior: "Senior",
};

function recommendationOf(session: MockInterviewSession): string | null {
  const feedback = session.overall_feedback;
  if (!feedback) return null;
  const upper = feedback.toUpperCase();
  return RECOMMENDATIONS.find((label) => upper.includes(label)) ?? "BORDERLINE";
}

function companyLabelOf(session: MockInterviewSession): string {
  if (session.company === "custom") return session.custom_company ?? "Custom role";
  return COMPANY_OPTIONS.find((c) => c.key === (session.company as CompanyKey))?.label ?? session.company;
}

function stagesOf(session: MockInterviewSession): string[] {
  try {
    const parsed = JSON.parse(session.stages_config) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Every interview this user has run, newest first, read from the server rather than
 * localStorage so the list is the same on any device. Finished runs open their saved
 * debrief (the summary endpoint returns the stored copy once a run is complete, so
 * revisiting one costs nothing); unfinished runs drop back into the stage they stopped at.
 */
export default function MockInterviewHistory() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<MockInterviewSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMockInterviewSessions()
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your interviews.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page page-narrow">
      <button className="mock-back-link" onClick={() => navigate("/mock-interview")}>
        <ArrowLeft size={16} /> Mock Interview
      </button>

      <div className="page-header">
        <div>
          <span className="eyebrow">Mock Interview Mode</span>
          <h1 style={{ marginTop: 6 }}>Past interviews</h1>
          <p className="muted small" style={{ marginTop: 6 }}>
            Every loop you have run, saved to your account. Open one to reread the debrief.
          </p>
        </div>
        <Briefcase size={26} style={{ color: "var(--green-dark)", flexShrink: 0, marginTop: 4 }} />
      </div>

      {error ? (
        <div className="card mock-error-card">
          <AlertCircle size={20} style={{ color: "var(--error)" }} />
          <p>{error}</p>
        </div>
      ) : !sessions ? (
        <LoadingNotice title="Loading your interviews" estimate="Reading your account history." />
      ) : sessions.length === 0 ? (
        <div className="card mock-history-empty">
          <p className="muted">You have not finished a mock interview yet.</p>
          <button className="button button-primary" onClick={() => navigate("/mock-interview")}>
            Start one <ChevronRight size={14} />
          </button>
        </div>
      ) : (
        <div className="mock-history-list">
          {sessions.map((session) => {
            const rec = recommendationOf(session);
            const meta = rec ? recommendationMeta(rec) : null;
            const RecIcon = meta?.icon;
            const complete = session.status === "complete";
            const stages = stagesOf(session);
            return (
              <button
                key={session.id}
                type="button"
                className="card mock-history-card"
                onClick={() =>
                  navigate(
                    complete
                      ? `/mock-interview/${session.id}/summary`
                      : `/mock-interview/${session.id}/${stages[0] ?? "stage1"}`,
                  )
                }
              >
                <div className="mock-history-main">
                  <div className="mock-history-title-row">
                    <span className="mock-history-company">{companyLabelOf(session)}</span>
                    {meta && RecIcon ? (
                      <span className={`mock-history-rec ${meta.className}`}>
                        <RecIcon size={13} />
                        {meta.label}
                      </span>
                    ) : (
                      <span className="mock-history-rec mock-history-rec--open">
                        <Clock size={13} />
                        In progress
                      </span>
                    )}
                  </div>
                  <div className="mock-history-meta muted small">
                    <span>{LEVEL_LABELS[session.level ?? "intern"] ?? session.level}</span>
                    {formatDate(session.created_at) ? <span>{formatDate(session.created_at)}</span> : null}
                  </div>
                  <MockLoopTrack stages={stages} current={complete ? "done" : "unknown"} compact />
                </div>
                <ChevronRight size={16} className="mock-history-chevron" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
