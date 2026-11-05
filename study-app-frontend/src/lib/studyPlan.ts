// Date and grouping helpers shared by the study plan widget and modal.
// Dates are local-calendar ISO strings (YYYY-MM-DD) so "today" means the
// student's today, not UTC's.

import type { StudyPlanItem, StudyPlanItemKind } from "./types";

export const KIND_LABEL: Record<StudyPlanItemKind, string> = {
  free_text: "Task",
  test: "Test",
  module: "Module",
  flashcards: "Flashcards",
  leetcode: "KojoCode",
  system_design: "System design",
  mock_interview: "Mock interview",
};

const DAY_MS = 86_400_000;

function parse(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayString(): string {
  return isoDate(new Date());
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);
}

/** "Today", "Tomorrow", "Yesterday", else "Sat, Nov 7". */
export function dayName(date: string, today = todayString()): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return parse(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Short chip text: "Today", "Tomorrow", "Sat", or "Nov 21" past a week. */
export function shortDay(date: string, today = todayString()): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) return parse(date).toLocaleDateString(undefined, { weekday: "short" });
  return parse(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function weekdayInitial(date: string): string {
  return parse(date).toLocaleDateString(undefined, { weekday: "narrow" });
}

export function dayOfMonth(date: string): number {
  return parse(date).getDate();
}

export function examCountdown(date: string): string {
  const days = daysBetween(todayString(), date);
  if (days < 0) return `Exam was ${-days}d ago`;
  if (days === 0) return "Exam today";
  if (days === 1) return "Exam tomorrow";
  return `Exam in ${days} days`;
}

export type DayGroup = {
  /** "overdue", "none", or an ISO date. */
  key: string;
  title: string;
  date: string | null;
  open: StudyPlanItem[];
  done: StudyPlanItem[];
};

/**
 * Groups items for the plan view: one "Overdue" bucket for open items past
 * their date, one group per date from today on, and "No date" last. Done
 * items stay under their own date so a day reads as finished, not empty.
 */
export function groupByDay(items: StudyPlanItem[], today = todayString()): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  const get = (key: string, title: string, date: string | null) => {
    let group = groups.get(key);
    if (!group) {
      group = { key, title, date, open: [], done: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    const due = item.due_date ?? null;
    if (!due) {
      const group = get("none", "No date", null);
      (item.done ? group.done : group.open).push(item);
    } else if (due < today && !item.done) {
      get("overdue", "Overdue", null).open.push(item);
    } else {
      const group = get(due, dayName(due, today), due);
      (item.done ? group.done : group.open).push(item);
    }
  }

  const rank = (g: DayGroup) => (g.key === "overdue" ? "0" : g.key === "none" ? "9" : `1${g.key}`);
  return [...groups.values()].sort((a, b) => rank(a).localeCompare(rank(b)));
}

/** Where a linked item's work happens, or null for a plain task. */
export function itemHref(item: StudyPlanItem): string | null {
  const id = item.target_id;
  if (id == null) return null;
  switch (item.kind) {
    case "test":
      return `/test/${id}`;
    case "module":
      return item.target_folder_id != null ? `/flashcards/${item.target_folder_id}/modules/${id}` : null;
    case "flashcards":
      return `/flashcards/${id}/review?due=1`;
    case "leetcode":
      return "/leetcode";
    case "system_design":
      return `/system-design/custom-${id}`;
    case "mock_interview":
      return `/mock-interview/${id}/resume`;
    default:
      return null;
  }
}
