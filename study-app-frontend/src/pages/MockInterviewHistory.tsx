import { AlertIcon, ArrowLeftIcon, ChevronRightIcon, TrashIcon } from "../icons";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SkeletonList } from "../components/Skeletons";
import { ConfirmModal } from "../components/ConfirmModal";
import { deleteMockInterviewSession, listMockInterviewSessions } from "../lib/api";
import { hydrateMockProgress, resumeRouteFor } from "../lib/mockInterview";
import type { MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { RECOMMENDATIONS, recommendationMeta } from "../data/mockInterviewLoop";
import "../styles/components/mock-debrief.css";
import "../styles/components/mock-history.css";

const LEVEL_LABELS: Record<string, string> = {
  intern: "Internship",
  junior: "New grad / Junior",
  mid: "Mid-level",
  senior: "Senior",
};

function recommendationOf(session: MockInterviewSession): string | null {
  if (session.skill_ratings) {
    try {
      const call = (JSON.parse(session.skill_ratings) as { call?: string }).call;
      if (call) return call;
    } catch {
      /* fall through to the text scan for older rows */
    }
  }
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
  const [pendingDelete, setPendingDelete] = useState<MockInterviewSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);

  // The stage pages need either the session in router state (what setup passes) or a
  // saved run snapshot; with neither they bounce to setup. So an unfinished run resumes
  // from its snapshot at the stage it stopped on, and a run that was never started (or
  // was set up by an AI app) opens its first stage with the session in hand.
  async function openSession(session: MockInterviewSession) {
    if (session.status === "complete") {
      navigate(`/mock-interview/${session.id}/summary`);
      return;
    }
    setOpeningId(session.id);
    const progress = await hydrateMockProgress(session.id).catch(() => null);
    setOpeningId(null);
    if (progress) {
      navigate(resumeRouteFor(progress));
      return;
    }
    const selectedStages = stagesOf(session);
    navigate(`/mock-interview/${session.id}/${selectedStages[0] ?? "stage1"}`, {
      state: { session, selectedStages },
    });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMockInterviewSession(pendingDelete.id);
      setSessions((rows) => (rows ?? []).filter((row) => row.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete that interview.");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

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

  const open = (sessions ?? []).filter((x) => x.status !== "complete");
  const finished = (sessions ?? []).filter((x) => x.status === "complete");

  return (
    <div className="history2">
      <header className="history2-head">
        <button type="button" className="debrief-back" onClick={() => navigate("/mock-interview")}>
          <ArrowLeftIcon size={16} /> Run an interview loop
        </button>
        <h1>Past interviews</h1>
      </header>

      {deleteError ? (
        <div className="history2-error" role="status">
          <AlertIcon size={18} /> {deleteError}
        </div>
      ) : null}

      {pendingDelete ? (
        <ConfirmModal
          title="Delete this interview?"
          message={`${companyLabelOf(pendingDelete)}, ${formatDate(pendingDelete.created_at) || "undated"}. Its results and debrief are deleted for good.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          busyLabel="Deleting"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}

      {error ? (
        <div className="history2-error">
          <AlertIcon size={18} /> {error}
        </div>
      ) : !sessions ? (
        <SkeletonList rows={4} label="Loading your interviews" />
      ) : sessions.length === 0 ? (
        <div className="history2-empty">
          <p>You have not run a mock interview yet.</p>
          <button type="button" className="debrief-btn debrief-btn-primary" onClick={() => navigate("/mock-interview")}>
            Run your first loop
          </button>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <section className="history2-section">
              <h2>In progress</h2>
              <div className="history2-list">
                {open.map((session) => {
                  const started = session.status !== "pending";
                  return (
                    <div key={session.id} className="history2-row">
                      <div className="history2-row-main">
                        <span className="history2-company">{companyLabelOf(session)}</span>
                        <span className="history2-sub">
                          {LEVEL_LABELS[session.level ?? "intern"] ?? session.level}
                          {formatDate(session.created_at) ? `, ${started ? "started" : "set up"} ${formatDate(session.created_at)}` : ""}
                          {started ? "" : ". Not started"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={started ? "debrief-btn debrief-btn-primary" : "debrief-btn"}
                        onClick={() => void openSession(session)}
                        disabled={openingId === session.id}
                        aria-busy={openingId === session.id}
                      >
                        {started ? "Resume" : "Start"}
                      </button>
                      <button
                        type="button"
                        className="history2-delete"
                        aria-label={`Delete ${companyLabelOf(session)} interview`}
                        onClick={() => setPendingDelete(session)}
                      >
                        <TrashIcon size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {finished.length > 0 && (
            <section className="history2-section">
              <h2>Finished</h2>
              <div className="history2-list">
                {finished.map((session) => {
                  const rec = recommendationOf(session);
                  const meta = rec ? recommendationMeta(rec) : null;
                  const tone = rec === "STRONG HIRE" || rec === "HIRE" || rec === "LEAN HIRE" ? "debrief-tone-good" : rec === "NO HIRE" || rec === "STRONG NO HIRE" ? "debrief-tone-bad" : "debrief-tone-mid";
                  return (
                    <div key={session.id} className="history2-row">
                      <button type="button" className="history2-row-link" onClick={() => void openSession(session)}>
                        <span className="history2-row-main">
                          <span className="history2-company">{companyLabelOf(session)}</span>
                          <span className="history2-sub">
                            {LEVEL_LABELS[session.level ?? "intern"] ?? session.level}
                            {formatDate(session.created_at) ? `, ${formatDate(session.created_at)}` : ""}
                          </span>
                        </span>
                        {meta && <span className={`history2-rec ${tone}`}>{meta.label}</span>}
                        <ChevronRightIcon size={18} />
                      </button>
                      <button
                        type="button"
                        className="history2-delete"
                        aria-label={`Delete ${companyLabelOf(session)} interview`}
                        onClick={() => setPendingDelete(session)}
                      >
                        <TrashIcon size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
