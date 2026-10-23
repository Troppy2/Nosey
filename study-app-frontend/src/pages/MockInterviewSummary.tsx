import { AlertIcon, ArrowLeftIcon, RetryIcon } from "../icons";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { MockLoader } from "../components/MockLoader";
import { finishMockInterview } from "../lib/api";
import type { MockInterviewFinishResponse, MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { clearActiveMockSession, type MockProgress } from "../lib/mockInterview";
import { MockProgressGate } from "../components/MockProgressGate";
import { MarkdownContent } from "../components/MarkdownContent";
import "../styles/components/mock-debrief.css";
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
      <MockLoader
        tone="page"
        title="Writing your debrief"
        note="Pulling together every round you finished. Around 20 seconds."
        slowNote="Still writing. A full loop takes the longest, keep this page open."
        slowAfterMs={25000}
      />
    );
  }

  if (loadError || !result) {
    return (
      <div className="page page-narrow">
        <div className="card mock-error-card">
          <AlertIcon size={20} style={{ color: "var(--error)" }} />
          <p>{loadError ?? "Could not generate summary."}</p>
          <div className="button-row" style={{ marginTop: 8 }}>
            <button className="button button-ghost" onClick={() => navigate("/mock-interview")}>
              Back to Setup
            </button>
            <button className="button button-primary" onClick={() => setAttempt((a) => a + 1)}>
              <RetryIcon size={14} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const recMeta = recommendationMeta(result.hiring_recommendation);
  const graded = LOOP_STAGES.filter((stage) => result[stage.verdictKey]);

  return (
    <div className="debrief">
      <header className="debrief-head">
        <button type="button" className="debrief-back" onClick={() => navigate("/mock-interview")}>
          <ArrowLeftIcon size={16} /> Mock interviews
        </button>
        <span className="debrief-kicker">{companyLabel}, full interview loop</span>
        <h1 className="debrief-word">{recMeta.label}</h1>
        <p className="debrief-lede">{recMeta.description}</p>
      </header>

      <section className="debrief-rows" aria-label="Verdict by round">
        {graded.map((stage) => {
          const meta = verdictMeta(result[stage.verdictKey]);
          return (
            <div key={stage.key} className="debrief-row debrief-row--solo">
              <div className="debrief-row-side">
                <h2>{stage.label}</h2>
                <span className={`debrief-verdict ${toneOf(result[stage.verdictKey])}`}>{meta.label}</span>
              </div>
            </div>
          );
        })}
      </section>

      {result.skill_ratings && Object.keys(result.skill_ratings).length > 0 && (
        <section className="debrief-rows" aria-label="Skill ratings">
          {SKILLS.filter((sk) => result.skill_ratings?.[sk.key]).map((sk) => {
            const rating = result.skill_ratings![sk.key];
            return (
              <div key={sk.key} className="debrief-row debrief-row--solo">
                <div className="debrief-row-side">
                  <h2>{sk.label}</h2>
                  <span className={`debrief-verdict ${hireTone(rating)}`}>{recommendationMeta(rating).label}</span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="debrief-section">
        <h2>Recruiter debrief</h2>
        <div className="debrief-body">
          <MarkdownContent content={result.overall_feedback} />
        </div>
      </section>

      <div className="debrief-actions">
        <button type="button" className="debrief-btn debrief-btn-primary" onClick={() => navigate("/mock-interview")}>
          Back to mock interviews
        </button>
      </div>
    </div>
  );
}

const SKILLS = [
  { key: "coding", label: "Coding" },
  { key: "problem_solving", label: "Problem solving" },
  { key: "communication", label: "Communication" },
  { key: "testing", label: "Testing and verification" },
];

function hireTone(call: string): string {
  if (call === "STRONG HIRE" || call === "HIRE" || call === "LEAN HIRE") return "debrief-tone-good";
  if (call === "NO HIRE" || call === "STRONG NO HIRE") return "debrief-tone-bad";
  return "debrief-tone-mid";
}

function toneOf(verdict?: string | null): string {
  if (verdict === "strong" || verdict === "pass") return "debrief-tone-good";
  if (verdict === "needs_work") return "debrief-tone-bad";
  return "debrief-tone-mid";
}
