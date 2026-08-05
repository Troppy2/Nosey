import { useEffect, useState } from "react";
import { hydrateMockProgress, loadMockProgress, type MockProgress } from "./mockInterview";

// Resolves the snapshot for one Mock Interview run, taking the newer of the local and
// cloud copies.
//
// Why the `ready` gate: every stage page seeds its React state once, at mount, from the
// snapshot (Stage 1 even freezes its problem set there so a reload cannot re-roll it).
// If a page rendered from the local copy while hydration was still in flight, it would
// initialise from stale state and then immediately save over the newer server copy. So
// pages hold their first render until this flips true.
export function useMockProgress(sessionId: number): { progress: MockProgress | null; ready: boolean } {
  const [progress, setProgress] = useState<MockProgress | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(sessionId)) {
      setProgress(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    hydrateMockProgress(sessionId)
      .then((resolved) => {
        if (cancelled) return;
        setProgress(resolved);
      })
      .catch(() => {
        if (cancelled) return;
        setProgress(loadMockProgress(sessionId));
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { progress, ready };
}
