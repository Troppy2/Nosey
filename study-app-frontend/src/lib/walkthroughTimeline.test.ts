import { describe, expect, it } from "vitest";
import type { SolutionWalkthrough } from "./types";
import { buildTimeline, chapterStart, formatClock, segmentAt } from "./walkthroughTimeline";

const walk: SolutionWalkthrough = {
  title: "Hash map",
  breakdown: ["We get nums and a target and return two indexes."],
  key_points: ["Find a pair"],
  approaches: [{ name: "Brute", time: "O(n^2)", space: "O(1)", verdict: "too slow", idea: "Pairs.", why: "Slow.", say: "Try every pair." }],
  code: [
    { line: "class Solution:", say: "" },
    { line: "    def f(self):", say: "The method we fill in." },
  ],
  frames: [{ say: "Here is the array.", strokes: [{ points: [0, 0, 10, 10], color: "ink" }], labels: [] }],
  time_complexity: "O(n)",
  space_complexity: "O(n)",
  complexity_say: "",
};

describe("walkthrough timeline", () => {
  it("orders chapters and makes segments contiguous", () => {
    const { segments, total } = buildTimeline(walk, "Two Sum");
    expect(segments.map((s) => s.kind)).toEqual(["intro", "breakdown", "approach", "frame", "code", "code", "complexity"]);
    segments.slice(1).forEach((s, i) => expect(s.start).toBeCloseTo(segments[i].start + segments[i].dur));
    expect(total).toBeCloseTo(segments[6].start + segments[6].dur);
    expect(chapterStart(segments, 3)).toBe(segments[4].start);
  });

  it("finds the segment at a time and formats the clock", () => {
    const { segments, total } = buildTimeline(walk, "Two Sum");
    expect(segmentAt(segments, 0)).toBe(0);
    expect(segmentAt(segments, segments[3].start + 0.01)).toBe(3);
    expect(segmentAt(segments, total + 5)).toBe(segments.length - 1);
    expect(formatClock(75.9)).toBe("1:15");
  });
});
