import { scopeKey } from "./api";
import type { RunnerResult } from "./pyodideRunner";

/** What one Submit looked like on this device. The server keeps only pass/fail and the
    time, so the result, runtime and Kojo's feedback are kept here and matched by time. */
export type SubmissionRecord = {
  at: string;
  result: RunnerResult;
  /** Time on the problem before this submit (since it was opened), in milliseconds. */
  elapsedMs?: number;
  feedback?: string;
};

const LIMIT = 30;
const MATCH_WINDOW_MS = 2 * 60 * 1000;
const key = (slug: string) => scopeKey("nosey_lc_submissions_" + slug);

/** Server timestamps without a zone are UTC (SQLite drops the offset). */
export function parseServerTime(value: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : value + "Z");
}

export function loadSubmissions(slug: string): SubmissionRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(slug)) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(slug: string, records: SubmissionRecord[]) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(records.slice(0, LIMIT)));
  } catch {
    /* Storage full or blocked: the server list still shows pass/fail. */
  }
}

const clip = (text: string) => (text.length > 2000 ? text.slice(0, 2000) + "..." : text);

export function addSubmission(slug: string, record: SubmissionRecord): SubmissionRecord {
  const stored: SubmissionRecord = {
    ...record,
    result: {
      ...record.result,
      error: record.result.error && clip(record.result.error),
      cases: record.result.cases?.map((item) => ({ ...item, actual: clip(item.actual), expected: clip(item.expected), input: item.input && clip(item.input) })),
    },
  };
  save(slug, [stored, ...loadSubmissions(slug).filter((item) => item.at !== record.at)]);
  return stored;
}

export function setSubmissionFeedback(slug: string, at: string, feedback: string) {
  save(slug, loadSubmissions(slug).map((item) => (item.at === at ? { ...item, feedback } : item)));
}

/** Pairs server rows with local records one to one: same verdict, within two minutes,
    closest pairs first, so two quick submits never share one record. */
export function matchSubmissions<Row extends { id: number; run_at: string; passed: boolean }>(
  rows: Row[],
  records: SubmissionRecord[],
): Map<number, SubmissionRecord> {
  const pairs: { id: number; record: SubmissionRecord; gap: number }[] = [];
  for (const row of rows) {
    const time = parseServerTime(row.run_at);
    for (const record of records) {
      const gap = Math.abs(Date.parse(record.at) - time);
      if (record.result.ok === row.passed && gap <= MATCH_WINDOW_MS) pairs.push({ id: row.id, record, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap);
  const matched = new Map<number, SubmissionRecord>();
  const used = new Set<string>();
  for (const pair of pairs) {
    if (matched.has(pair.id) || used.has(pair.record.at)) continue;
    matched.set(pair.id, pair.record);
    used.add(pair.record.at);
  }
  return matched;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + " s";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + " min " + (seconds % 60) + " s";
  return Math.floor(minutes / 60) + " h " + (minutes % 60) + " min";
}

export function formatRuntime(ms: number): string {
  return ms < 10 ? ms.toFixed(1) + " ms" : Math.round(ms) + " ms";
}
