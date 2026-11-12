import { useEffect, useRef } from "react";
import { PlayIcon } from "../icons";
import "../styles/components/mock-pause.css";

/** Covers a timed round while it is paused. The clock is stopped and the work is
 *  hidden, so a pause cannot be used to keep solving off the clock. */
export function MockPauseOverlay({ onResume, note }: { onResume: () => void; note?: string }) {
  const resumeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    resumeRef.current?.focus();
  }, []);

  return (
    <div className="mock-pause" role="dialog" aria-modal="true" aria-labelledby="mock-pause-title">
      <div className="mock-pause-card">
        <span className="mock-pause-eyebrow">Paused</span>
        <h2 id="mock-pause-title">The clock is stopped</h2>
        <p>{note ?? "Your code and transcript are saved. Pick up where you left off when you are ready."}</p>
        <button ref={resumeRef} type="button" className="button button-primary mock-pause-resume" onClick={onResume}>
          <PlayIcon size={15} /> Resume
        </button>
      </div>
    </div>
  );
}
