import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Auto-scroll behavior shared by every Kojo chat surface
 * (KojoChat, KojoHelpChat, KojoMode).
 *
 * Deterministic contract:
 *   - "At the bottom" is always recomputed from the live geometry of the actual
 *     scroll container (the element with `overflow-y: auto`):
 *       `scrollHeight - scrollTop - clientHeight <= threshold`
 *   - The scroll container's own `scroll` event updates the state the moment
 *     the user scrolls anywhere.
 *   - A `MutationObserver` watches the message DOM, so EVERY content change —
 *     streamed tokens, restored conversations, loading bubbles, error banners,
 *     images/KaTeX reflowing — deterministically re-measures and, if the user
 *     was at the bottom, pins to the newest content. No call site can forget
 *     to list the right dependency.
 *   - A `ResizeObserver` handles the panel/viewport changing size (fullscreen
 *     toggle, drawer open/close, window resize).
 *   - The first time real content appears, the container pins to the bottom
 *     once (restored conversations land at the newest message).
 *   - A manual scroll-up always wins: while `atBottom` is false, no content
 *     change scrolls the container, even mid-stream.
 *   - The "scroll to latest" button is visible only when `atBottom === false`.
 *
 * Usage:
 *   const { containerRef, endRef, atBottom, scrollToBottom } = useChatScroll();
 *   <div ref={containerRef} className="...messages">... <div ref={endRef} /> </div>
 *   <button hidden={atBottom} className="kojo-scroll-bottom" onClick={scrollToBottom}>...</button>
 */
export type ChatScrollOptions = {
  /** Optional extra follow signals for state-only changes that don't mutate the
   *  message DOM (e.g. a loading flag that only re-renders an indicator). The
   *  MutationObserver already covers most cases; this is a backstop. */
  deps?: ReadonlyArray<unknown>;
  /** Distance in pixels from the bottom that still counts as "at the bottom".
   *  Kept generous so a just-grown token between mutation and follow doesn't
   *  flicker the button. */
  threshold?: number;
};

export type ChatScrollApi = {
  /** Ref for the scroll container (the element with `overflow-y: auto`). */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Ref for the empty marker placed at the very end of the message list. */
  endRef: React.RefObject<HTMLDivElement>;
  /** True when the user is at (or within `threshold` px of) the bottom of the
   *  scroll container. Drives the "scroll to latest" button visibility. */
  atBottom: boolean;
  /** Scroll the container to the latest message. `"smooth"` by default (the
   *  manual button); use `"auto"` for programmatic jumps. The only valid
   *  browser behavior values are `"smooth"` and `"auto"`. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
};

const DEFAULT_THRESHOLD = 96;

export function useChatScroll({
  deps = [],
  threshold = DEFAULT_THRESHOLD,
}: ChatScrollOptions = {}): ChatScrollApi {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Authority for "is the user at the bottom right now": a ref so the follow
  // pass can read it without being recreated, mirrored into state for renders.
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // True once we've pinned to the bottom for whatever content existed on
  // (re)mount. After that, follows only happen while the user stays put.
  const hasFollowedRef = useRef(false);
  // Guards against scheduling multiple visit passes in the same frame.
  const visitRafRef = useRef<number | null>(null);

  const measureAtBottom = useCallback((): boolean => {
    const el = containerRef.current;
    if (!el) return true;
    // Nothing to scroll yet — unquestionably "at the bottom".
    if (el.scrollHeight <= el.clientHeight + 1) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }, [threshold]);

  const setAtBottomValue = useCallback((next: boolean) => {
    if (next !== atBottomRef.current) {
      atBottomRef.current = next;
      setAtBottom(next);
    }
  }, []);

  /** One combined pass after DOM/layout changes: recompute `atBottom` from the
   *  real geometry, then (optionally) pin to the newest content. */
  const visit = useCallback(() => {
    if (visitRafRef.current != null) return; // already scheduled this frame
    visitRafRef.current = requestAnimationFrame(() => {
      visitRafRef.current = null;
      const el = containerRef.current;
      if (!el) return;

      const freshAtBottom = measureAtBottom();
      setAtBottomValue(freshAtBottom);

      // Follow only if the user was at the bottom before this change — except
      // the very first visit after (re)mount, which deterministically pins
      // restored content to the newest message.
      const shouldFollow = !hasFollowedRef.current || atBottomRef.current;
      if (!shouldFollow) return;

      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      hasFollowedRef.current = true;
      atBottomRef.current = true;
      setAtBottom(true);
    });
  }, [measureAtBottom, setAtBottomValue]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    hasFollowedRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // A fresh container (mount, or KojoMode's view switch remounting the
    // message column) starts deterministically: at the bottom, and the first
    // visit pins whatever content exists there.
    hasFollowedRef.current = false;
    atBottomRef.current = true;
    setAtBottom(true);

    // 1. Live scroll events: the user's position is authoritative the moment
    //    they scroll, and any scroll counts as "has followed" so the initial
    //    pin never fights a user who scrolled up during first paint.
    const onScroll = () => {
      hasFollowedRef.current = true;
      setAtBottomValue(measureAtBottom());
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    // 2. Any content mutation re-measures + follows. childList/subtree/charData
    //    covers whole messages, streamed text, restored history, and reflows.
    //    Attributes are intentionally excluded: React toggling the button's
    //    `hidden` attribute would otherwise loop the observer.
    const mo = new MutationObserver(() => visit());
    mo.observe(el, { childList: true, subtree: true, characterData: true });

    // 3. Resize of the container (fullscreen, drawer, viewport) re-measures.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => visit());
      ro.observe(el);
    }

    // 4. First measurement after real layout exists.
    visit();

    return () => {
      el.removeEventListener("scroll", onScroll);
      mo.disconnect();
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current]);

  // Dep backstop: state-only changes (a loading flag that doesn't mutate the
  // message DOM) still get a follow pass, after React has committed.
  useEffect(() => {
    visit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { containerRef, endRef, atBottom, scrollToBottom };
}