import { describe, expect, it } from "vitest";
import {
  currentTurn,
  gateEditorUrl,
  gateUrl,
  progressLine,
  readGateSolve,
  reasonCheck,
  reopensIn,
  solveLine,
  statementParagraphs,
  withoutFollowUp,
} from "./trailGate";
import type { PTGateAttempt, PTGateItem } from "./types";

function item(position: number, over: Partial<PTGateItem> = {}): PTGateItem {
  return {
    id: 100 + position,
    position,
    difficulty: "Medium",
    time_limit_s: 1500,
    picked_key: null,
    correct: null,
    right_pattern: null,
    cue: null,
    kojo_note: null,
    solved: null,
    seconds: null,
    ...over,
  };
}

function attempt(items: PTGateItem[], over: Partial<PTGateAttempt> = {}): PTGateAttempt {
  const picked = items.filter((i) => i.picked_key != null);
  return {
    attempt_id: 7,
    topic_slug: "sliding-window",
    topic_title: "Sliding window",
    started_at: "2026-11-26T10:00:00Z",
    finished_at: null,
    picks_made: picked.length,
    correct_count: picked.filter((i) => i.correct).length,
    need: 4,
    passed: null,
    locked_until: null,
    options: [{ key: "fixed-window", title: "Fixed window" }],
    items,
    ...over,
  };
}

const right = (p: number, solved: boolean | null = true) =>
  item(p, { picked_key: "fixed-window", correct: true, solved, seconds: solved ? 600 : null });
const missed = (p: number, solved: boolean | null = true) =>
  item(p, { picked_key: "fixed-window", correct: false, solved, seconds: solved ? 600 : null });

describe("gate urls", () => {
  it("never carries a problem slug", () => {
    expect(gateUrl("sliding-window")).toBe("/pattern-trails/gate/sliding-window");
    expect(gateUrl("sliding-window", 7)).toBe("/pattern-trails/gate/sliding-window?attempt=7");
    expect(gateEditorUrl(7, 103, "sliding-window")).toBe("/leetcode?trailGate=7&gateItem=103&gateTopic=sliding-window");
  });
});

describe("currentTurn", () => {
  it("solves a picked problem before the next pick, then ends", () => {
    expect(currentTurn(attempt([item(1), item(2)]))).toMatchObject({ item: { position: 1 }, phase: "pick" });
    expect(currentTurn(attempt([right(1, null), item(2)]))).toMatchObject({ item: { position: 1 }, phase: "solve" });
    expect(currentTurn(attempt([right(1), item(2)]))).toMatchObject({ item: { position: 2 }, phase: "pick" });
    expect(currentTurn(attempt([right(1), missed(2, false)]))).toBeNull();
  });
  it("follows position, not array order", () => {
    expect(currentTurn(attempt([item(2), right(1)]))?.item.position).toBe(2);
  });
});

describe("progressLine", () => {
  it("counts toward the 4 needed", () => {
    expect(progressLine(attempt([item(1), item(2), item(3), item(4), item(5)]))).toBe("No picks yet, need 4 right");
    expect(progressLine(attempt([right(1), right(2), item(3), item(4), item(5)]))).toBe("2 right so far, need 4");
    expect(progressLine(attempt([missed(1), missed(2), item(3), item(4), item(5)]))).toBe(
      "0 right so far, the gate cannot pass this time",
    );
    expect(progressLine(attempt([right(1), right(2), right(3), right(4), item(5)]))).toBe("4 right, enough to pass");
    expect(progressLine(attempt([right(1)], { passed: true, correct_count: 4 }))).toBe("4 right, gate cleared");
    expect(progressLine(attempt([right(1)], { passed: false, correct_count: 3 }))).toBe("3 right, needed 4");
  });
});

describe("reasonCheck", () => {
  it("says why the button is off, then counts", () => {
    expect(reasonCheck("   short ")).toEqual({ ok: false, hint: "Write a few words on why" });
    expect(reasonCheck("contiguous and positive")).toEqual({ ok: true, hint: "23 of 200" });
  });
});

describe("copy", () => {
  it("rounds the reopen time up to whole hours", () => {
    const now = new Date("2026-11-26T10:00:00Z");
    expect(reopensIn("2026-11-27T09:30:00Z", now)).toBe("Opens again in 24 hours");
    expect(reopensIn("2026-11-26T10:20:00Z", now)).toBe("Opens again in 1 hour");
    expect(reopensIn(null, now)).toBe("Opens again in 24 hours");
  });
  it("describes the solve", () => {
    expect(solveLine(item(1))).toBeNull();
    expect(solveLine(right(1))).toBe("Solved in 10 minutes");
    expect(solveLine(missed(1, false))).toBe("Not solved, it comes back as a redo");
  });
  it("splits override statements into paragraphs", () => {
    expect(statementParagraphs("One.\n\n  Two.\n\n\n")).toEqual(["One.", "Two."]);
  });
});

describe("withoutFollowUp", () => {
  it("drops a follow-up that could name the technique", () => {
    const html =
      "<p>Find the shortest piece.</p><p><strong>Constraints:</strong></p><ul><li>n &lt; 10</li></ul>" +
      "<p><strong>Follow up:</strong> Can you do it with a sliding window?</p><p>More.</p>";
    const out = withoutFollowUp(html);
    expect(out).toContain("Constraints");
    expect(out).not.toMatch(/sliding window/i);
    expect(out).not.toContain("More.");
  });
  it("handles a wrapper div and the hyphenated form", () => {
    const out = withoutFollowUp("<div><p>Body.</p><p><b>Follow-up:</b> O(n) with two pointers?</p></div>");
    expect(out).toContain("Body.");
    expect(out).not.toMatch(/two pointers/i);
  });
  it("leaves a statement without a follow-up alone", () => {
    expect(withoutFollowUp("<p>Plain.</p>")).toBe("<p>Plain.</p>");
  });
});

describe("readGateSolve", () => {
  it("reads the editor hand-back and rejects junk", () => {
    expect(readGateSolve({ gateSolve: { itemId: 3, solved: true, slow: true, redoDueAt: "x" } })).toEqual({
      itemId: 3,
      solved: true,
      slow: true,
      redoDueAt: "x",
    });
    expect(readGateSolve({ gateSolve: { itemId: "3", solved: true } })).toBeNull();
    expect(readGateSolve(null)).toBeNull();
  });
});
