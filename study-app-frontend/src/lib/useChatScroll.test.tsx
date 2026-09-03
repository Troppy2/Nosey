import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatScroll } from "./useChatScroll";

// jsdom does not implement `Element.prototype.scrollTo` at all. The hook and
// the test spy drive scrolling through it, so provide a real per-element
// implementation that writes `scrollTopRef` (mirroring the browser, where
// scrollTo changes the scroll position that the harness getter then reads).
function installScrollTo(el: HTMLElement, scrollTopRef: { current: number }) {
  Object.defineProperty(el, "scrollTo", {
    value: (opts: { top: number; behavior?: string }) => {
      scrollTopRef.current = opts.top;
    },
    configurable: true,
    writable: true,
  });
}

type Handle = {
  atBottom: () => boolean;
  /** Simulate the user scrolling to a pixel offset (fires the scroll event). */
  scrollToOffset: (top: number) => void;
  /** Grow scrollHeight by `delta`, then insert one more message (DOM mutation
   *  the MutationObserver picks up). */
  appendMessage: (delta: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  containerEl: () => any;
  clickScrollToBottom: () => void;
};

type HarnessProps = {
  /** Number of messages rendered from the start. */
  initialCount: number;
  /** Initial content scrollHeight. */
  initialHeight: number;
  clientHeight: number;
  onHandle: (h: Handle) => void;
};

let nextInstanceId = 0;
function Harness({ initialCount, initialHeight, clientHeight, onHandle }: HarnessProps) {
  const [count, setCount] = useState(initialCount);
  const instanceIdRef = useRef(nextInstanceId++);
  // eslint-disable-next-line no-console
  console.error("DEBUG render instance", instanceIdRef.current, "count", count);
  const { containerRef, endRef, atBottom, scrollToBottom } = useChatScroll({ deps: [count] });

  const scrollHeightRef = useRef(initialHeight);
  const scrollTopRef = useRef(0);

  // Re-stamp the geometry the hook reads. Runs on every commit, so the test
  // harness can change the refs and a re-render makes the hook see them.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el: any = containerRef.current;
    if (!el) return;
    Object.defineProperty(el, "scrollHeight", {
      get: () => scrollHeightRef.current,
      configurable: true,
    });
    Object.defineProperty(el, "clientHeight", {
      get: () => clientHeight,
      configurable: true,
    });
    Object.defineProperty(el, "scrollTop", {
      get: () => scrollTopRef.current,
      set: (v: number) => { scrollTopRef.current = v; },
      configurable: true,
    });
    installScrollTo(el, scrollTopRef);
  });

  onHandle({
    atBottom: () => {
      // eslint-disable-next-line no-console
      console.error("DEBUG handle.atBottom ->", atBottom);
      return atBottom;
    },
    scrollToOffset: (top) => {
      scrollTopRef.current = top;
      containerRef.current?.dispatchEvent(new Event("scroll"));
    },
    appendMessage: (delta) => {
      scrollHeightRef.current += delta;
      setCount((c) => c + 1);
    },
    containerEl: () => containerRef.current,
    clickScrollToBottom: () => scrollToBottom(),
  });

  return (
    <div>
      <div ref={containerRef} data-testid="container">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} data-testid={`msg-${i}`}>
            message {i}
          </div>
        ))}
        <div ref={endRef} data-testid="end" />
      </div>
    </div>
  );
}

function flush() {
  // Flush rAF (faked by vitest) + microtasks (MutationObserver callbacks).
  return act(async () => {
    await vi.runAllTimersAsync();
  });
}

/** Run an action that updates hook state, then flush effects/rAF/microtasks so
 *  the next `handle.atBottom()` reads a fresh render. */
async function actAndFlush(action: () => void) {
  await act(async () => {
    action();
    await vi.runAllTimersAsync();
  });
}

describe("useChatScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // Unmount any component still mounted from the previous test so its
    // observers/listeners/rAF callbacks can't re-render and clobber the
    // shared `handle` reference of the next test.
    cleanup();
    vi.useRealTimers();
  });

  it("deterministically pins to the newest content on mount (restored conversation)", async () => {
    let handle: Handle | null = null;
    render(
      <Harness
        initialCount={8}
        initialHeight={2000}
        clientHeight={400}
        onHandle={(h) => { handle = h; }}
      />,
    );
    await flush();

    const el = handle!.containerEl();
    expect(el.scrollTop).toBe(2000); // scrolled to the true bottom
    expect(handle!.atBottom()).toBe(true);
  });

  it("follows streamed content while the user is at the bottom", async () => {
    let handle: Handle | null = null;
    render(
      <Harness
        initialCount={8}
        initialHeight={2000}
        clientHeight={400}
        onHandle={(h) => { handle = h; }}
      />,
    );
    await flush(); // initial pin
    expect(handle!.atBottom()).toBe(true);

    // A token arrives: content grows, the DOM mutates (a new message render).
    handle!.appendMessage(120);
    await flush();

    const el = handle!.containerEl();
    expect(el.scrollTop).toBe(2120); // followed to the new bottom
    expect(handle!.atBottom()).toBe(true);
  });

  it("stops following once the user scrolls up, even during streaming", async () => {
    let handle: Handle | null = null;
    render(
      <Harness
        initialCount={8}
        initialHeight={2000}
        clientHeight={400}
        onHandle={(h) => { handle = h; }}
      />,
    );
    await flush(); // initial pin to 2000
    expect(handle!.atBottom()).toBe(true);

    // User scrolls up to the top: the scroll event must immediately flip
    // atBottom to false (button appears).
    await actAndFlush(() => handle!.scrollToOffset(0));
    // eslint-disable-next-line no-console
    console.error("DEBUG after actAndFlush");
    void handle!.atBottom();
    // Not using waitFor here: it interacts poorly with fake timers.
    await flush();
    void handle!.atBottom();
    expect(handle!.atBottom()).toBe(false);

    // ...and the next token must NOT drag them back down.
    await actAndFlush(() => handle!.appendMessage(120));
    await flush();

    const el = handle!.containerEl();
    expect(el.scrollTop).toBe(0); // untouched
    expect(handle!.atBottom()).toBe(false);
  });

  it("scrollToBottom uses smooth behavior and reports atBottom", async () => {
    let handle: Handle | null = null;
    render(
      <Harness
        initialCount={8}
        initialHeight={2000}
        clientHeight={400}
        onHandle={(h) => { handle = h; }}
      />,
    );
    await flush();

    // Scroll up so the test has something to return from.
    await actAndFlush(() => handle!.scrollToOffset(0));
    await waitFor(() => expect(handle!.atBottom()).toBe(false));

    let captured: { behavior: string } | null | undefined;
    const el = handle!.containerEl();
    const original = el.scrollTo;
    el.scrollTo = (opts: { top: number; behavior?: string }) => {
      captured = { behavior: opts.behavior ?? "" };
      original(opts);
    };

    act(() => {
      handle!.clickScrollToBottom();
    });
    if (!captured) throw new Error("scrollToBottom did not call scrollTo");
    expect(captured.behavior).toBe("smooth");
    expect(handle!.atBottom()).toBe(true);
  });
});