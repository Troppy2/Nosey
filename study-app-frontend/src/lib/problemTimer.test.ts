import { beforeEach, expect, it, vi } from "vitest";
import { countdown, formatClock, loadTimer, pause, restart, resume, saveTimer, shownMs, stopwatch } from "./problemTimer";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

it("counts down from the clock, not from ticks", () => {
  const timer = countdown(25, 0);
  expect(shownMs(timer, 60_000)).toBe(24 * 60_000);
  expect(formatClock(shownMs(timer, 0), true)).toBe("25:00");
  expect(formatClock(shownMs(timer, 1), true)).toBe("25:00");
});

it("keeps time still while paused and picks up on resume", () => {
  const paused = pause(countdown(10, 0), 30_000);
  expect(shownMs(paused, 500_000)).toBe(9.5 * 60_000);
  const resumed = resume(paused, 500_000);
  expect(shownMs(resumed, 530_000)).toBe(9 * 60_000);
});

it("shows overtime past zero and a stopwatch counting up", () => {
  expect(formatClock(shownMs(countdown(1, 0), 75_000), true)).toBe("+0:15");
  expect(formatClock(shownMs(stopwatch(0), 3_725_000))).toBe("1:02:05");
});

it("restarts from the top and clears the zero notice", () => {
  const over = { ...countdown(1, 0), overNotified: true };
  const again = restart(over, 90_000);
  expect(shownMs(again, 90_000)).toBe(60_000);
  expect(again.overNotified).toBe(false);
});

it("saves per problem and drops damaged values", () => {
  saveTimer("two-sum", countdown(15, 0));
  expect(loadTimer("two-sum")?.totalMs).toBe(15 * 60_000);
  expect(loadTimer("valid-anagram")).toBeNull();
  saveTimer("two-sum", null);
  expect(loadTimer("two-sum")).toBeNull();
});
