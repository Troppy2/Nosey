import { useEffect, useRef, useState } from "react";
import { useMobileShell } from "./useMobileShell";

const TRIGGER_PX = 72;
const MAX_PULL_PX = 110;

/**
 * Swipe-down-to-refresh, mobile shell only. Arms only when the page is
 * already scrolled to the top (so it never fights a normal downward scroll
 * mid-list), tracks the drag distance, and fires `onRefresh` once the finger
 * is released past the trigger threshold.
 *
 * Returns `pullPx` (0 while idle, eases toward MAX_PULL_PX while dragging) and
 * `isRefreshing`, so the caller can render its own indicator inline with
 * `components/Loaders.tsx`'s `Spinner` rather than a new one.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const isMobileShell = useMobileShell();
  const [pullPx, setPullPx] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!isMobileShell || reduceMotion.current) return;

    function handleTouchStart(e: TouchEvent) {
      if (window.scrollY > 0 || isRefreshing) {
        armed.current = false;
        return;
      }
      armed.current = true;
      startY.current = e.touches[0].clientY;
    }

    function handleTouchMove(e: TouchEvent) {
      if (!armed.current || startY.current == null) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPullPx(0);
        return;
      }
      // Slight resistance past the threshold so it doesn't feel unbounded.
      const eased = delta < MAX_PULL_PX ? delta : MAX_PULL_PX + (delta - MAX_PULL_PX) * 0.2;
      setPullPx(eased);
    }

    async function handleTouchEnd() {
      if (!armed.current) return;
      armed.current = false;
      startY.current = null;
      setPullPx((current) => {
        if (current >= TRIGGER_PX) {
          setIsRefreshing(true);
          Promise.resolve(onRefresh()).finally(() => setIsRefreshing(false));
        }
        return 0;
      });
    }

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileShell, isRefreshing]);

  return { pullPx, isRefreshing, isMobileShell };
}
