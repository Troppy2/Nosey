import { useEffect, useState } from "react";
import { Button } from "./Button";
import { InlineLoading } from "./Loaders";
import { getMe, isGuestSession, submitDateOfBirth } from "../lib/api";

// Pops the date-of-birth modal for an already signed-in user whose age is null
// in the database. Mounted once in the signed-in shell so it covers every page.
// The Landing page handles the prompt for brand-new sign-ins; this covers
// existing accounts that never got asked.
export function AgeGateModal() {
  const [show, setShow] = useState(false);
  const [dob, setDob] = useState("");
  const [dobError, setDobError] = useState<string | null>(null);
  const [dobLoading, setDobLoading] = useState(false);

  useEffect(() => {
    if (isGuestSession()) return;
    let cancelled = false;
    getMe()
      .then((user) => {
        if (!cancelled && !user.is_guest && user.age == null) setShow(true);
      })
      .catch(() => { /* ignore: never block the app on this check */ });
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Date of birth" onMouseDown={(e) => e.stopPropagation()}>
        <h2>One quick thing</h2>
        <p className="muted">We use your date of birth to personalize your experience. This is kept private and never shared.</p>
        <input
          type="date"
          className="modal-input"
          value={dob}
          onChange={(e) => { setDob(e.target.value); setDobError(null); }}
          max={new Date().toISOString().split("T")[0]}
          autoFocus
        />
        {dobError && <p style={{ color: "var(--red, #c0392b)", fontSize: "0.875rem" }}>{dobError}</p>}
        <div className="button-row">
          <Button
            variant="primary"
            disabled={!dob || dobLoading}
            onClick={async () => {
              setDobLoading(true);
              setDobError(null);
              try {
                await submitDateOfBirth(dob);
                setShow(false);
              } catch {
                setDobError("Could not save your date of birth. Please try again.");
                setDobLoading(false);
              }
            }}
          >
            {dobLoading ? <InlineLoading label="Saving" /> : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}
