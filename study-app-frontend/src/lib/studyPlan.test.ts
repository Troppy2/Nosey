import { describe, expect, it } from "vitest";
import { addDays, groupByDay, itemHref } from "./studyPlan";
import type { StudyPlanItem } from "./types";

const TODAY = "2026-11-04";

let nextId = 1;
function item(patch: Partial<StudyPlanItem>): StudyPlanItem {
  const id = nextId++;
  return {
    id,
    plan_id: 1,
    position: id,
    kind: "free_text",
    label: `Item ${id}`,
    due_date: null,
    done: false,
    created_at: "2026-11-01T00:00:00",
    ...patch,
  };
}

describe("groupByDay", () => {
  it("puts open overdue work first, then each day in order, undated last", () => {
    const groups = groupByDay(
      [
        item({ label: "later", due_date: addDays(TODAY, 3) }),
        item({ label: "no date" }),
        item({ label: "late", due_date: addDays(TODAY, -2) }),
        item({ label: "today", due_date: TODAY }),
        item({ label: "tomorrow", due_date: addDays(TODAY, 1) }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.title)).toEqual(["Overdue", "Today", "Tomorrow", expect.any(String), "No date"]);
    expect(groups[0].open.map((i) => i.label)).toEqual(["late"]);
  });

  it("keeps done items under their own date, not in Overdue", () => {
    const groups = groupByDay([item({ label: "finished", due_date: addDays(TODAY, -1), done: true })], TODAY);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Yesterday");
    expect(groups[0].done.map((i) => i.label)).toEqual(["finished"]);
    expect(groups[0].open).toHaveLength(0);
  });

  it("orders items inside a day by position", () => {
    const [group] = groupByDay(
      [item({ label: "b", due_date: TODAY, position: 5 }), item({ label: "a", due_date: TODAY, position: 1 })],
      TODAY,
    );
    expect(group.open.map((i) => i.label)).toEqual(["a", "b"]);
  });
});

describe("itemHref", () => {
  it("links each linked kind to where its work happens", () => {
    expect(itemHref(item({ kind: "test", target_id: 7 }))).toBe("/test/7");
    expect(itemHref(item({ kind: "module", target_id: 9, target_folder_id: 3 }))).toBe("/flashcards/3/modules/9");
    expect(itemHref(item({ kind: "flashcards", target_id: 3 }))).toBe("/flashcards/3/review?due=1");
    expect(itemHref(item({ kind: "system_design", target_id: 4 }))).toBe("/system-design/custom-4");
    expect(itemHref(item({ kind: "mock_interview", target_id: 2 }))).toBe("/mock-interview/2/resume");
  });

  it("has no link for plain tasks or a module whose folder is unknown", () => {
    expect(itemHref(item({}))).toBeNull();
    expect(itemHref(item({ kind: "module", target_id: 9 }))).toBeNull();
  });
});
