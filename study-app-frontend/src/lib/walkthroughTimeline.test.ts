import { describe, expect, it } from "vitest";
import type { KojoLecture, SolutionWalkthrough } from "./types";
import { buildLectureTimeline, buildTimeline, chapterStart, formatClock, segmentAt, spokenLines } from "./walkthroughTimeline";

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
    expect(segments.map((s) => s.scene.type)).toEqual(["title", "title", "cards", "ink", "code", "code", "code"]);
    expect(segments.map((s) => s.chapter)).toEqual([0, 0, 1, 2, 3, 3, 3]);
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

  it("builds a lecture in four chapters and lists each spoken line once", () => {
    const frame = { say: "Draw it.", strokes: [{ points: [0, 0, 5, 5], color: "ink" as const }], labels: [] };
    const lecture: KojoLecture = {
      title: "Prefix Sums",
      summary: "Running totals.",
      theory: [{ say: "Keep a running total.", point: "running total" }, { say: "Subtract two totals.", point: "range = diff" }],
      theory_frames: [frame],
      signals: [{ signal: "sum of a subarray", example: "subarray sum equals k", say: "Subarray sums are the clue." }],
      template: [{ line: "prefix = [0]", say: "Start at zero." }],
      problem_intro: [{ say: "Count subarrays summing to k.", point: "count sums" }],
      frames: [frame],
      code: [{ line: "class Solution:", say: "" }],
      time_complexity: "O(n)",
      space_complexity: "O(n)",
      complexity_say: "",
    };
    const tl = buildLectureTimeline(lecture, "Subarray Sum Equals K");
    expect(tl.chapters).toEqual(["Theory", "Spot it", "Template", "Walkthrough"]);
    expect(tl.segments.map((s) => s.chapter)).toEqual([0, 0, 0, 0, 1, 2, 3, 3, 3, 3]);
    const lines = spokenLines(tl);
    expect(lines.filter((l) => l === "Draw it.")).toHaveLength(1);
  });
});
