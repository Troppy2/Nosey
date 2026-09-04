import { useEffect, useRef, useState } from "react";
import KojoRunnerGame from "./KojoRunnerGame";
import {
  checkBackendNow,
  dismissBackendRecovery,
  getBackendStatus,
  subscribeBackendStatus,
  type BackendStatus,
} from "../lib/backendStatus";

// Timestamp (ms since epoch) of when the current waiting period started. Persisted
// so a refresh during downtime does not reset the counter to zero; cleared when
// the server comes back.
const WAITING_SINCE_KEY = "nosey_server_waiting_since";

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function WaitingScreen() {
  const [status, setStatus] = useState<BackendStatus>(getBackendStatus());
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => subscribeBackendStatus(setStatus), []);

  // Move focus into the dialog so keyboard and screen-reader users land on the
  // primary action instead of the document body behind the overlay.
  useEffect(() => {
    primaryRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (getBackendStatus() === "recovered") {
        dismissBackendRecovery();
      } else {
        void checkBackendNow();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (status === "recovered") {
      try {
        window.localStorage.removeItem(WAITING_SINCE_KEY);
      } catch {
        // storage unavailable; the timer simply restarts on the next screen
      }
      return;
    }
    try {
      if (!window.localStorage.getItem(WAITING_SINCE_KEY)) {
        window.localStorage.setItem(WAITING_SINCE_KEY, String(Date.now()));
      }
    } catch {
      // storage unavailable; fall back to an in-memory start time
    }
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(tick);
  }, [status]);

  const recovered = status === "recovered";
  let elapsedSeconds = 0;
  if (!recovered) {
    try {
      const sinceMs = Number(window.localStorage.getItem(WAITING_SINCE_KEY)) || Date.now();
      elapsedSeconds = Math.max(0, Math.floor((now - sinceMs) / 1000));
    } catch {
      elapsedSeconds = 0;
    }
  }

  const handleCheckAgain = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await checkBackendNow();
    } finally {
      setChecking(false);
    }
  };

  const handleReturn = () => {
    window.location.reload();
  };

  return (
    <div className="waiting-screen" role="dialog" aria-modal="true" aria-labelledby="waiting-title" aria-describedby="waiting-body">
      <div className="waiting-card">
        <div className="waiting-head" aria-live="polite" aria-atomic="true">
          {recovered ? (
            <>
              <p className="waiting-eyebrow">Server is back</p>
              <h1 className="waiting-title" id="waiting-title">
                Kojo caught the yarn!
              </h1>
              <p className="waiting-body" id="waiting-body">
                The server finished waking up and your app is ready. You can head back in and pick up exactly where you left off.
              </p>
            </>
          ) : (
            <>
              <p className="waiting-eyebrow">Nosey is waking up</p>
              <h1 className="waiting-title" id="waiting-title">
                Kojo is chasing your server back
              </h1>
              <p className="waiting-body" id="waiting-body">
                Nosey runs on a free web tier, so the backend powers down after a while without traffic. This screen appears
                while it boots back up. Your data is safe and nothing is lost. The app checks automatically and will let you
                back in the moment it is ready.
              </p>
            </>
          )}
        </div>

        {!recovered && (
          <div className="waiting-meta">
            <div className="waiting-timer-block">
              <span className="waiting-meta-label">Time waiting</span>
              <span className="waiting-timer">{formatElapsed(elapsedSeconds)}</span>
            </div>
            <div className="waiting-status" aria-live="polite">
              <span className="waiting-status-dot" aria-hidden="true" />
              We'll let you back in the moment it answers
            </div>
          </div>
        )}

        <div className="waiting-game-stage" data-dimmed={recovered || undefined}>
          <KojoRunnerGame />
        </div>
        <p className="waiting-game-hint">
          Tap, click, or press <kbd>Space</kbd> to hop Kojo over the boulders. Hold it for a longer jump.
        </p>

        {recovered ? (
          <div className="waiting-actions">
            <button ref={primaryRef} type="button" className="button button-secondary" onClick={() => dismissBackendRecovery()}>
              Not now
            </button>
            <button type="button" className="button button-primary" onClick={handleReturn}>
              Take me back
            </button>
          </div>
        ) : (
          <div className="waiting-actions">
            <button ref={primaryRef} type="button" className="button button-secondary" onClick={() => void handleCheckAgain()} disabled={checking}>
              {checking ? "Checking…" : "Check again"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}