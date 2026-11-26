import { describe, expect, it } from "vitest";
import {
  dueIn,
  gateStatus,
  kojoIndex,
  pathStops,
  problemTitle,
  readWalkState,
  redoRunUrl,
  shortTitle,
  stepEditorUrl,
  subtopicStatus,
} from "./trailView";
import type { PTGateState, PTPath, PTRedo, PTStep, PTSubtopicSummary } from "./types";

const NOW = new Date(2026, 10, 26, 12, 0, 0);

function step(position: number, state: PTStep["state"], extra: Partial<PTStep> = {}): PTStep {
  return {
    id: 100 + position,
    position,
    problem_slug: "minimum-window-substring",
    difficulty: "Hard",
    time_limit_s: 2400,
    state,
    locked_reason: state === "locked" ? `Pass step ${position - 1} first` : null,
    attempts: 0,
    best_seconds: null,
    passed_at: null,
    redo: null,
    ...extra,
  };
}

function path(over: Partial<PTPath> = {}): PTPath {
  return {
    topic_slug: "sliding-window",
    topic_title: "Sliding window",
    slug: "shortest-valid-window",
    title: "Shortest valid window",
    summary: "",
    cues: [],
    template_code: "",
    open: true,
    locked_reason: null,
    lesson: { lecture_slug: null, watched: true, watched_at: null },
    steps: [step(1, "passed"), step(2, "passed"), step(3, "open"), step(4, "locked"), step(5, "locked")],
    finished: false,
    solved_count: 2,
    next_subtopic_slug: "counting-subarrays",
    ...over,
  };
}

const redo = (due: boolean, dueAt: string): PTRedo => ({
  id: 9,
  problem_slug: "minimum-size-subarray-sum",
  step_id: 101,
  subtopic_slug: "shortest-valid-window",
  position: 1,
  gate_item_id: null,
  time_limit_s: 1500,
  interval_index: 1,
  due_at: dueAt,
  due,
  last_result: "slow",
});

describe("trail view", () => {
  it("builds lesson, five steps and the yarn, with Kojo on the open step", () => {
    const stops = pathStops(path(), NOW);
    expect(stops.map((s) => s.kind)).toEqual(["lesson", "step", "step", "step", "step", "step", "yarn"]);
    expect(stops.map((s) => s.state)).toEqual(["done", "done", "done", "current", "locked", "locked", "locked"]);
    expect(stops[3].status).toBe("Kojo is here");
    expect(stops[3].detail).toContain("40 minutes");
    expect(stops[4].lockedReason).toBe("Pass step 3 first");
    expect(stops[6].lockedReason).toBe("Pass step 5 first");
    expect(kojoIndex(path())).toBe(3);
  });

  it("keeps Kojo on the lesson until it is watched, and says how it opens", () => {
    const p = path({
      lesson: { lecture_slug: null, watched: false, watched_at: null },
      steps: [1, 2, 3, 4, 5].map((n) => step(n, "locked", { locked_reason: "Watch the lesson first" })),
    });
    const stops = pathStops(p, NOW);
    expect(stops[0].state).toBe("current");
    expect(stops[0].detail).toContain("Read Kojo's notes");
    expect(stops[1].lockedReason).toBe("Watch the lesson first");
    expect(kojoIndex(p)).toBe(0);
    const withVideo = pathStops({ ...p, lesson: { ...p.lesson, lecture_slug: "sliding-window-variable" } }, NOW);
    expect(withVideo[0].detail).toContain("video ends");
  });

  it("puts Kojo on the yarn when the path is finished", () => {
    const p = path({ finished: true, steps: [1, 2, 3, 4, 5].map((n) => step(n, "passed")) });
    expect(kojoIndex(p)).toBe(6);
    expect(pathStops(p, NOW)[6].state).toBe("done");
  });

  it("shows a waiting redo as a dated wilted flower and a due one as due", () => {
    const p = path({
      steps: [
        step(1, "passed", { redo: redo(false, new Date(2026, 10, 32, 9).toISOString()) }),
        step(2, "passed", { redo: redo(true, new Date(2026, 10, 25).toISOString()) }),
        step(3, "open"),
        step(4, "locked"),
        step(5, "locked"),
      ],
    });
    const stops = pathStops(p, NOW);
    expect(stops[1].redo).toEqual({ due: false, label: "Redo in 6 days" });
    expect(stops[2].redo).toEqual({ due: true, label: "Redo due" });
  });

  it("words dates, titles, map and gate lines", () => {
    expect(dueIn(new Date(2026, 10, 26, 23).toISOString(), NOW)).toBe("today");
    expect(dueIn(new Date(2026, 10, 27, 1).toISOString(), NOW)).toBe("tomorrow");
    expect(problemTitle("minimum-window-substring")).toBe("Minimum Window Substring");
    expect(problemTitle("not-in-the-catalog-at-all")).toBe("Not in the Catalog at All");
    expect(shortTitle("Minimum Window Substring")).toBe("Minimum Window");
    const sub = (o: Partial<PTSubtopicSummary>): PTSubtopicSummary => ({
      slug: "s",
      title: "Fixed window",
      summary: "",
      open: true,
      finished: false,
      lesson_watched: true,
      step_states: ["passed", "passed", "open", "locked", "locked"],
      passed_count: 2,
      stats: { recognition: null, picks: 0, solve_rate: null, solve_attempts: 0, weak: false },
      ...o,
    });
    const subs = [sub({}), sub({ title: "Shortest valid window", open: false })];
    expect(subtopicStatus(subs[0], 0, subs)).toBe("Kojo is at step 3 of 5");
    expect(subtopicStatus(subs[1], 1, subs)).toBe("Opens after Fixed window");
    const gate: PTGateState = { state: "cooldown", cleared: false, need: 4, size: 5, attempt_id: null, locked_until: new Date(NOW.getTime() + 5.5 * 3_600_000).toISOString(), best_correct: 3 };
    expect(gateStatus(gate, NOW)).toBe("Opens again in 6 hours");
    expect(gateStatus({ ...gate, state: "locked" }, NOW)).toBe("Opens after every path here");
    expect(gateStatus({ ...gate, cleared: true, best_correct: 5 }, NOW)).toBe("Cleared, 5 of 5 picked right");
  });

  it("reads the walk handed back by the editor and rejects junk", () => {
    expect(readWalkState({ trailWalk: { walkedTo: 4, solvedDelta: 1, slow: false, redoDueAt: null } })).toEqual({
      walkedTo: 4,
      solvedDelta: 1,
      slow: false,
      redoDueAt: null,
    });
    expect(readWalkState({ trailWalk: { walkedTo: 0 } })).toBeNull();
    expect(readWalkState({ trailWalk: "x" })).toBeNull();
    expect(readWalkState(null)).toBeNull();
  });

  it("builds editor links for a step and for a redo run", () => {
    expect(stepEditorUrl("two-sum", 7)).toBe("/leetcode?problem=two-sum&trailStep=7");
    expect(redoRunUrl([])).toBeNull();
    expect(redoRunUrl([redo(true, NOW.toISOString()), { ...redo(true, NOW.toISOString()), id: 12 }])).toBe(
      "/leetcode?problem=minimum-size-subarray-sum&trailRedos=9,12",
    );
  });
});
