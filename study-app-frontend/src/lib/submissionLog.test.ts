import { beforeEach, expect, it, vi } from "vitest";
import { addSubmission, formatDuration, loadSubmissions, matchSubmissions, parseServerTime, setSubmissionFeedback } from "./submissionLog";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
});

const result = (ok: boolean) => ({ ok, output: ok ? "All tests passed." : "Some tests failed.", runtime_ms: 1.2 });

it("keeps the newest submit first and stores Kojo's feedback on it", () => {
  addSubmission("two-sum", { at: "2026-11-27T10:00:00.000Z", result: result(false) });
  addSubmission("two-sum", { at: "2026-11-27T10:05:00.000Z", result: result(true), elapsedMs: 90_000 });
  setSubmissionFeedback("two-sum", "2026-11-27T10:05:00.000Z", "Clean hash map.");
  const records = loadSubmissions("two-sum");
  expect(records.map((r) => r.at)).toEqual(["2026-11-27T10:05:00.000Z", "2026-11-27T10:00:00.000Z"]);
  expect(records[0].feedback).toBe("Clean hash map.");
});

it("reads a zoneless server time as UTC", () => {
  expect(parseServerTime("2026-11-27T10:00:00")).toBe(Date.parse("2026-11-27T10:00:00Z"));
  expect(parseServerTime("2026-11-27T10:00:00+00:00")).toBe(Date.parse("2026-11-27T10:00:00Z"));
});

it("pairs rows and records one to one by verdict and time", () => {
  const records = [
    { at: "2026-11-27T10:00:05.000Z", result: result(false) },
    { at: "2026-11-27T10:01:00.000Z", result: result(false) },
  ];
  const rows = [
    { id: 2, run_at: "2026-11-27T10:01:01", passed: false },
    { id: 1, run_at: "2026-11-27T10:00:06", passed: false },
    { id: 0, run_at: "2026-11-27T09:00:00", passed: false },
  ];
  const matched = matchSubmissions(rows, records);
  expect(matched.get(2)?.at).toBe("2026-11-27T10:01:00.000Z");
  expect(matched.get(1)?.at).toBe("2026-11-27T10:00:05.000Z");
  expect(matched.has(0)).toBe(false);
});

it("formats time spent", () => {
  expect(formatDuration(42_000)).toBe("42 s");
  expect(formatDuration(843_000)).toBe("14 min 3 s");
});
