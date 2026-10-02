import { useEffect, useRef } from "react";
import { driver, type Alignment, type DriveStep, type Driver, type Side } from "driver.js";
import "driver.js/dist/driver.css";
import "../../styles/components/tours.css";
import {
  getMe,
  getStoredUser,
  hasCompletedOnboarding,
  hasSeenTour,
  hasTourState,
  isGuestSession,
  markTourSeen,
  type TourId,
} from "../../lib/api";
import { MOBILE_SHELL_QUERY } from "../../lib/useMobileShell";
import { TOURS, type TourStep } from "./tourSteps";

// Wait after the page reports ready, so late layout (fonts, images, skeleton
// swaps) has settled before driver.js measures anything.
const START_DELAY_MS = 600;
// While something else owns the screen (the practice run, the age gate, any
// modal) the tour waits and checks again at this interval.
const BLOCKED_RETRY_MS = 1000;
// After an action step's click, time for the UI it opened to render.
const AFTER_ACTION_MS = 450;

// One /auth/me per page load at most, shared by every tour that needs it.
let userRefresh: Promise<unknown> | null = null;
function refreshUserOnce(): Promise<unknown> {
  userRefresh ??= getMe().catch(() => undefined);
  return userRefresh;
}

function findVisible(selector: string): Element | null {
  // A zero-size box covers display:none (desktop-only controls on the mobile
  // shell and vice versa) and collapsed panels. The horizontal check covers
  // off-canvas drawers, which are laid out but translated off screen. Below
  // the fold is fine: driver.js scrolls to it. A page can tag two copies of a
  // control (header and empty state); the first one actually shown wins.
  for (const el of document.querySelectorAll(selector)) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && box.right > 0 && box.left < window.innerWidth) return el;
  }
  return null;
}

function isBlocked(): boolean {
  if (!hasCompletedOnboarding()) return true;
  return document.querySelector('[aria-modal="true"]') !== null;
}

function placement(step: TourStep, mobile: boolean): { side?: Side; align?: Alignment } {
  if (!mobile) return { side: step.side, align: step.align };
  // Phones have no room beside an element, so everything stacks.
  const side = step.side === "left" || step.side === "right" ? "bottom" : step.side;
  return { side, align: "center" };
}

/**
 * Runs a page's first-visit tour once per account.
 *
 * `ready` is the page saying its tour targets are on screen (data loaded, not
 * an empty state). The tour is marked seen the moment it is shown, not when
 * it is finished: leaving halfway must not bring it back, which is the
 * mistake the old cross-page tour made.
 *
 * Once shown, a tour lives until it ends or the page unmounts. `ready`
 * flickering back to false (a list re-fetching) must not tear it down: it is
 * already marked seen, so it would never come back.
 *
 * Steps run in segments. A step with `action` ends its segment and waits for
 * the user to click the real control; the next segment is measured only after
 * that click, so it can target UI the click opened (Advanced mode's panel,
 * the back of a flashcard).
 */
export function usePageTour(id: TourId, ready = true) {
  const sessionRef = useRef<{ shown: boolean; stop: () => void } | null>(null);

  // Unmount only: the one place a shown tour is torn down from outside.
  useEffect(
    () => () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!ready || sessionRef.current?.shown) return;
    const tour = TOURS[id];
    if (tour.signedInOnly && isGuestSession()) return;

    let cancelled = false;
    let timer: number | undefined;
    let active: Driver | null = null;
    let detachAction: (() => void) | null = null;

    const schedule = (fn: () => void, ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fn, ms);
    };

    const teardown = () => {
      detachAction?.();
      detachAction = null;
      const current = active;
      active = null;
      current?.destroy();
    };

    // Builds and drives the segment starting at `from`. Returns false when
    // nothing from there on is on screen.
    const runSegment = (from: number): boolean => {
      const mobile = window.matchMedia(MOBILE_SHELL_QUERY).matches;
      const segment: { step: TourStep; element: Element | null }[] = [];
      let resumeAt = -1;

      for (let i = from; i < tour.steps.length; i += 1) {
        const step = tour.steps[i];
        if (step.skipIf && findVisible(step.skipIf)) continue;
        const element = step.element ? findVisible(step.element) : null;
        if (step.element && !element) continue;
        segment.push({ step, element });
        if (step.action) {
          resumeAt = i + 1;
          break;
        }
      }
      if (segment.length === 0) return false;

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const steps: DriveStep[] = segment.map(({ step, element }, index) => {
        const popover: DriveStep["popover"] = {
          title: step.title,
          description: step.body,
          ...placement(step, mobile),
        };
        // driver.js shows a disabled Back on a segment's first step; there is
        // nothing behind it, so drop the button instead.
        if (index === 0) popover.showButtons = ["next", "close"];
        if (step.action) {
          // No Next button, and swallow the right-arrow shortcut too: the only
          // way on is to do the thing.
          popover.showButtons = ["close"];
          popover.onNextClick = () => {};
        }
        return {
          element: element ?? undefined,
          popover,
          onHighlighted: step.action && element ? () => attachAction(element, resumeAt) : undefined,
        };
      });

      const d = driver({
        steps,
        popoverClass: "nosey-tour",
        animate: !reduceMotion,
        smoothScroll: !reduceMotion,
        overlayColor: "#26301f",
        overlayOpacity: 0.42,
        stagePadding: 6,
        stageRadius: 10,
        popoverOffset: 12,
        allowClose: true,
        showProgress: false,
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Got it",
        onDestroyed: () => {
          detachAction?.();
          detachAction = null;
          if (active === d) active = null;
        },
      });
      active = d;
      d.drive();
      return true;
    };

    const attachAction = (element: Element, resumeAt: number) => {
      detachAction?.();
      const onClick = () => {
        detachAction = null;
        teardown();
        if (resumeAt < 0) return;
        schedule(() => {
          if (!cancelled) runSegment(resumeAt);
        }, AFTER_ACTION_MS);
      };
      element.addEventListener("click", onClick, { once: true });
      detachAction = () => element.removeEventListener("click", onClick);
    };

    const attempt = () => {
      if (cancelled) return;
      if (hasSeenTour(id)) return;
      if (isBlocked()) {
        schedule(attempt, BLOCKED_RETRY_MS);
        return;
      }
      if (runSegment(0)) {
        session.shown = true;
        void markTourSeen(id);
      }
    };

    const begin = async () => {
      // A user copy cached before tours existed cannot answer "seen?", and
      // guessing "no" would ambush existing users. Ask the server first.
      if (!hasTourState()) await refreshUserOnce();
      if (cancelled) return;
      if (hasSeenTour(id)) {
        // Seen locally (or as a guest before signing in) but not on the
        // account yet: carry it over so the next device agrees.
        if (!getStoredUser()?.tours_seen?.includes(id)) void markTourSeen(id);
        return;
      }
      schedule(attempt, START_DELAY_MS);
    };

    const session = {
      shown: false,
      stop: () => {
        cancelled = true;
        window.clearTimeout(timer);
        teardown();
      },
    };
    sessionRef.current = session;
    void begin();

    return () => {
      // Not shown yet: drop the pending start; the next `ready` retries it.
      if (session.shown) return;
      session.stop();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [id, ready]);
}
