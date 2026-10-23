import { useEffect, useState } from "react";
import "../styles/components/mock-loader.css";

/** True once `ms` have passed since mount, so a fast load still shows the loader long enough to read. */
export function useMinElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setElapsed(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return elapsed;
}

/**
 * Full-screen wait for the Mock Interview rounds. Drawn like the room it opens into
 * (same ground, same orb), so the round fades in instead of jumping out of a card.
 */
export function MockLoader({
  title,
  note,
  slowNote,
  slowAfterMs = 12000,
  tone = "room",
}: {
  /** Active phrase: "Preparing your interviewer". */
  title: string;
  note?: string;
  /** Replaces `note` after `slowAfterMs`. */
  slowNote?: string;
  slowAfterMs?: number;
  /** "room" matches the voice rounds, "page" the OA and debrief ground. */
  tone?: "room" | "page";
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!slowNote) return;
    setSlow(false);
    const t = window.setTimeout(() => setSlow(true), slowAfterMs);
    return () => window.clearTimeout(t);
  }, [slowNote, slowAfterMs, title]);

  const line = slow && slowNote ? slowNote : note;

  return (
    <div className={`mock-loader mock-loader--${tone}`} role="status" aria-live="polite">
      <div className="mock-loader-orb" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} />
        ))}
      </div>
      <h1 className="mock-loader-title">{title}</h1>
      {line && (
        <p className="mock-loader-note" key={slow ? "slow" : "note"}>
          {line}
        </p>
      )}
      <div className="mock-loader-track" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
