import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ONBOARDING_DONE_KEY, completeOnboarding, getMe, hasCompletedOnboarding, scopeKey } from "../lib/api";
import { OnboardingSandbox } from "./onboarding/OnboardingSandbox";

export { ONBOARDING_DONE_KEY };

/**
 * Key written by the old multi-page driver.js tour to remember which page it
 * was mid-handoff to. It no longer means anything, but it is still sitting in
 * the localStorage of everyone who ever started that tour, and the old guard
 * let it override a completed flag. That is what made the tour reappear at
 * random for people who had already finished it: close the tab during a
 * handoff and the breadcrumb was orphaned forever. Kept only so it can be
 * cleaned up on sight.
 */
export const TOUR_SEGMENT_KEY = "nosey_tour_segment";

/**
 * Gate for the first-run practice run.
 *
 * Completion lives on the account (users.onboarding_completed_at) with a
 * localStorage mirror, so there is exactly one answer to "has this person been
 * onboarded" and it follows them across browsers and devices. There is no
 * resume state of any kind: the run is a single self-contained component, so
 * there is nothing to leave half-finished and no breadcrumb to go stale.
 */
export function OnboardingTour() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Clear the dead breadcrumb from the previous tour on every mount.
    localStorage.removeItem(scopeKey(TOUR_SEGMENT_KEY));
    localStorage.removeItem(TOUR_SEGMENT_KEY);

    if (hasCompletedOnboarding()) return;

    let cancelled = false;
    // The local mirror is empty on a browser this account has not used before,
    // which is not the same as never having been onboarded. Ask the server
    // before deciding to interrupt someone.
    getMe()
      .then(() => {
        if (!cancelled && !hasCompletedOnboarding()) setOpen(true);
      })
      .catch(() => {
        if (!cancelled) setOpen(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const close = useCallback((_outcome: "finished" | "skipped") => {
    // Skipping counts as completion. Re-ambushing someone who has already said
    // no is what made the old tour feel broken; Settings has a Replay control
    // for anyone who wants it back.
    setOpen(false);
    void completeOnboarding();
  }, []);

  const goToCreateTest = useCallback(() => navigate("/create-test"), [navigate]);

  if (!open) return null;
  return <OnboardingSandbox onClose={close} onCreateTest={goToCreateTest} />;
}
