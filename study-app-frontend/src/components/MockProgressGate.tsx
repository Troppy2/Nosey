import type { ReactNode } from "react";
import { LoadingNotice } from "./Loaders";
import type { MockProgress } from "../lib/mockInterview";
import { useMockProgress } from "../lib/useMockProgress";

/**
 * Holds a Mock Interview page's first render until the local and cloud snapshots have
 * been reconciled, then hands the winner to the page.
 *
 * Every stage page seeds its React state once, at mount, from the snapshot (Stage 1
 * freezes its problem set there so a reload cannot re-roll the assessment). Rendering
 * before hydration resolves would initialise from a stale local copy and then save
 * straight over the newer server one, which is exactly the data loss the cloud sync
 * exists to prevent.
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
  if (!ready) {
    return (
      <div className="page page-narrow">
        <LoadingNotice title={label} estimate="Restoring where you left off." />
      </div>
    );
  }
  return <>{render(progress)}</>;
}
