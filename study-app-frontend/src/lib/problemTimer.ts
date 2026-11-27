import { scopeKey } from "./api";

/** A problem's timer. Time is read from the clock (startedAt), never counted tick by tick,
    so it stays exact in a background tab and across reloads. */
export type ProblemTimer = {
  mode: "timer" | "stopwatch";
  /** Countdown length; null for the stopwatch. */
  totalMs: number | null;
  /** Time banked before the current run (pauses add up here). */
  elapsedMs: number;
  /** When the current run started; null while paused. */
  startedAt: number | null;
  /** The countdown already reached zero and said so. */
  overNotified?: boolean;
};

export const TIMER_PRESETS = [
  { minutes: 15, caption: "Quick rep" },
  { minutes: 25, caption: "Standard" },
  { minutes: 45, caption: "Deep dive" },
];

export const elapsedOf = (timer: ProblemTimer, now: number) =>
  timer.elapsedMs + (timer.startedAt != null ? now - timer.startedAt : 0);

/** Countdown: time left (negative in overtime). Stopwatch: time elapsed. */
export function shownMs(timer: ProblemTimer, now: number): number {
  const elapsed = elapsedOf(timer, now);
  return timer.mode === "timer" && timer.totalMs != null ? timer.totalMs - elapsed : elapsed;
}

export const countdown = (minutes: number, now: number): ProblemTimer => ({
  mode: "timer",
  totalMs: Math.round(minutes * 60_000),
  elapsedMs: 0,
  startedAt: now,
});
export const stopwatch = (now: number): ProblemTimer => ({ mode: "stopwatch", totalMs: null, elapsedMs: 0, startedAt: now });

export function pause(timer: ProblemTimer, now: number): ProblemTimer {
  return timer.startedAt == null ? timer : { ...timer, elapsedMs: elapsedOf(timer, now), startedAt: null };
}
export function resume(timer: ProblemTimer, now: number): ProblemTimer {
  return timer.startedAt != null ? timer : { ...timer, startedAt: now };
}
/** Back to the start, keeping the mode and whether it was running. */
export function restart(timer: ProblemTimer, now: number): ProblemTimer {
  return { ...timer, elapsedMs: 0, startedAt: timer.startedAt != null ? now : null, overNotified: false };
}

/** "12:05", "1:02:05", and "+3:10" for overtime. A countdown rounds up (it reads 25:00 at
    the start and 0:00 only at zero); a stopwatch rounds down. */
export function formatClock(ms: number, roundUp = false): string {
  const over = ms < 0;
  const seconds = Math.abs(ms) / 1000;
  const total = roundUp && !over ? Math.ceil(seconds) : Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  const clock = h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  return over ? "+" + clock : clock;
}

const key = (slug: string) => scopeKey("nosey_lc_timer_" + slug);

export function loadTimer(slug: string): ProblemTimer | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(slug)) ?? "null");
    return value && (value.mode === "timer" || value.mode === "stopwatch") && typeof value.elapsedMs === "number" ? value : null;
  } catch {
    return null;
  }
}

export function saveTimer(slug: string, timer: ProblemTimer | null) {
  try {
    if (timer) localStorage.setItem(key(slug), JSON.stringify(timer));
    else localStorage.removeItem(key(slug));
  } catch {
    /* Storage unavailable: the timer lasts for this visit. */
  }
}
