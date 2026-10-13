import { useEffect, useState } from "react";
import { Button } from "./Button";
import { signOut } from "../lib/api";
import { onSafety, type SafetyKind } from "../lib/safetyEvents";

// One modal for every moderation outcome (GH #173), mounted once in App.
// Self-harm never blocks anything: Kojo still answers, and this sits on top
// with people the student can reach right now.
export function SafetyModal() {
  const [kind, setKind] = useState<SafetyKind | null>(null);

  useEffect(
    () =>
      onSafety((next) => {
        // A suspension outranks anything already showing.
        setKind((current) => (current === "suspended" ? current : next));
      }),
    [],
  );

  useEffect(() => {
    if (!kind || kind === "suspended") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setKind(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind]);

  if (!kind) return null;

  function leave() {
    signOut();
    window.location.href = "/";
  }

  const close = () => setKind(null);

  return (
    <div className="modal-backdrop" onMouseDown={kind === "suspended" ? undefined : close}>
      <div
        className="modal-card safety-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {kind === "self-harm" ? (
          <>
            <h2 id="safety-modal-title">You don't have to deal with this alone</h2>
            <p className="muted">
              If you're thinking about hurting yourself, please reach out to someone now. It's free,
              confidential, and open 24/7.
            </p>
            <ul className="safety-modal-list">
              <li>
                <strong>Call or text 988</strong> (Suicide &amp; Crisis Lifeline, US)
              </li>
              <li>
                <strong>Text HOME to 741741</strong> (Crisis Text Line)
              </li>
              <li>
                Outside the US: <a href="https://findahelpline.com" target="_blank" rel="noreferrer">findahelpline.com</a>
              </li>
              <li>If you're in immediate danger, call your local emergency number.</li>
            </ul>
            <div className="button-row">
              <Button onClick={close}>Close</Button>
            </div>
          </>
        ) : kind === "warning-allowed" ? (
          <>
            <h2 id="safety-modal-title">Some of what you wrote breaks Nosey's rules</h2>
            <p className="muted">
              Your work was still submitted. Content like this (weapons, threats or graphic violence) is
              reviewed, and repeating it can get your account banned.
            </p>
            <div className="button-row">
              <Button onClick={close}>Got it</Button>
            </div>
          </>
        ) : kind === "warning" ? (
          <>
            <h2 id="safety-modal-title">That request was blocked</h2>
            <p className="muted">
              It goes against Nosey's rules (things like weapons, threats or graphic violence). Repeated
              requests like this can get your account banned.
            </p>
            <div className="button-row">
              <Button onClick={close}>Got it</Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="safety-modal-title">This account has been suspended</h2>
            <p className="muted">
              It broke Nosey's rules. If you think this is a mistake, email{" "}
              <a href="mailto:jamesinah34@gmail.com">jamesinah34@gmail.com</a>.
            </p>
            <div className="button-row">
              <Button onClick={leave}>Sign out</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
