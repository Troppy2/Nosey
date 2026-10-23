import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LoadingNotice } from "./Loaders";
import { getMockInterviewSession } from "../lib/api";
import type { MockProgress } from "../lib/mockInterview";
import type { MockInterviewSession } from "../lib/types";
import { useMockProgress } from "../lib/useMockProgress";

type GateState = { session?: MockInterviewSession; selectedStages?: string[] } | null;

function stagesOf(session: MockInterviewSession): string[] {
  try {
    const parsed = JSON.parse(session.stages_config) as unknown;
    return Array.isArray(parsed) ? parsed.filter((stage): stage is string => typeof stage === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Holds a Mock Interview page's first render until the local and cloud snapshots have
 * been reconciled, then hands the winner to the page.
 *
 * Every stage page seeds its React state once, at mount, from the snapshot (Stage 1
 * freezes its problem set there so a reload cannot re-roll the assessment). Rendering
 * before hydration resolves would initialise from a stale local copy and then save
 * straight over the newer server one, which is exactly the data loss the cloud sync
 * exists to prevent.
 *
 * A page also needs the session itself when there is no snapshot yet: setup passes it
 * in router state, but a run opened from Past interviews, an AI-app link, or a refresh
 * before the first sync has neither, and the page used to bounce back to setup. In that
 * case the session is fetched here and put into router state before the page mounts.
 */
export function MockProgressGate({
  sessionId,
  label,
  render,
}: {
  sessionId: number;
  /** Active phrase for the wait, e.g. "Loading your assessment". */
  label: string;
  render: (stored: MockProgress | null) => ReactNode;
}) {
  const { progress, ready } = useMockProgress(sessionId);
  const location = useLocation();
  const navigate = useNavigate();
  const hasSession = Boolean((location.state as GateState)?.session);
  const needsSession = ready && !progress && !hasSession;
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!needsSession || fetchFailed) return;
    let cancelled = false;
    getMockInterviewSession(sessionId)
      .then((session) => {
        if (cancelled) return;
        navigate(`${location.pathname}${location.search}`, {
          replace: true,
          state: { session, selectedStages: stagesOf(session) },
        });
      })
      .catch(() => {
        // Gone or not ours: let the page fall back to setup as before.
        if (!cancelled) setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needsSession, fetchFailed, sessionId, location.pathname, location.search, navigate]);

  if (!ready || (needsSession && !fetchFailed)) {
    return (
      <div className="page page-narrow">
        <LoadingNotice title={label} estimate="Restoring where you left off." />
      </div>
    );
  }
  return <>{render(progress)}</>;
}
