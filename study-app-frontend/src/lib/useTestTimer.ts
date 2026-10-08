import { useEffect, useRef, useState } from "react";

// A test timer: a stopwatch, or a countdown that keeps counting past zero as
// overtime. State is saved per test so a refresh or a resumed draft keeps the
// clock. Elapsed time is stored as accumulated + (now - startedAt), so a tab
// left in the background never drifts.

export type TimerMode = "stopwatch" | "countdown";

export type TimerState = {
  mode: TimerMode;
  durationMs: number; // countdown length; ignored by the stopwatch
  accumulatedMs: number; // time banked by earlier runs
  startedAt: number | null; // epoch ms of the current run, null when paused/stopped
  notified: boolean; // the time's-up notice already fired for this countdown
};

const DEFAULT_STATE: TimerState = {
  mode: "stopwatch",
  durationMs: 30 * 60_000,
  accumulatedMs: 0,
  startedAt: null,
  notified: false,
};

function load(key: string): TimerState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<TimerState>;
    return {
      mode: parsed.mode === "countdown" ? "countdown" : "stopwatch",
      durationMs: Math.max(60_000, Number(parsed.durationMs) || DEFAULT_STATE.durationMs),
      accumulatedMs: Math.max(0, Number(parsed.accumulatedMs) || 0),
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : null,
      notified: parsed.notified === true,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function useTestTimer(storageKey: string) {
  const [state, setState] = useState<TimerState>(() => load(storageKey));
  const [now, setNow] = useState(() => Date.now());
  const running = state.startedAt !== null;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* storage full or blocked: the timer still works for this session */
    }
  }, [storageKey, state]);

  // Ticks only while running; 250ms keeps the seconds digit from lagging.
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsedMs = state.accumulatedMs + (state.startedAt !== null ? Math.max(0, now - state.startedAt) : 0);
  const remainingMs = state.durationMs - elapsedMs;
  const isCountdown = state.mode === "countdown";
  const overtime = isCountdown && remainingMs <= 0;
  const idle = !running && state.accumulatedMs === 0;

  // Fire the time's-up callback once per countdown run.
  const onTimeUpRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (overtime && running && !state.notified) {
      setState((s) => ({ ...s, notified: true }));
      onTimeUpRef.current?.();
    }
  }, [overtime, running, state.notified]);

  return {
    state,
    running,
    idle,
    elapsedMs,
    remainingMs,
    overtime,
    // Share of the countdown left, 1 -> 0. The stopwatch has none.
    fraction: isCountdown ? Math.max(0, Math.min(1, remainingMs / state.durationMs)) : null,
    onTimeUp(handler: () => void) {
      onTimeUpRef.current = handler;
    },
    start() {
      setState((s) => (s.startedAt !== null ? s : { ...s, startedAt: Date.now() }));
    },
    pause() {
      setState((s) =>
        s.startedAt === null ? s : { ...s, accumulatedMs: s.accumulatedMs + (Date.now() - s.startedAt), startedAt: null },
      );
    },
    stop() {
      setState((s) => ({ ...s, accumulatedMs: 0, startedAt: null, notified: false }));
    },
    restart() {
      setState((s) => ({ ...s, accumulatedMs: 0, startedAt: Date.now(), notified: false }));
    },
    // Switching mode or length resets the clock: a half-run countdown re-timed
    // to a new length has no meaningful elapsed time to keep.
    configure(mode: TimerMode, durationMs?: number) {
      setState((s) => ({
        mode,
        durationMs: durationMs ?? s.durationMs,
        accumulatedMs: 0,
        startedAt: null,
        notified: false,
      }));
    },
  };
}

// 0:07, 12:47, 1:04:09
export function formatClock(ms: number): { main: string; seconds: string } {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const main = h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}`;
  return { main, seconds: String(s).padStart(2, "0") };
}
