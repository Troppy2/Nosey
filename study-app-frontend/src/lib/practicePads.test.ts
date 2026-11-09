import { describe, expect, it } from "vitest";
import { splitLessonBlocks } from "../pages/LearningModuleLesson";
import { isScratchpadBlock, practiceLayout } from "./practicePads";

const LESSON = [
  "## Worked example 1 (full)",
  "",
  "Sample 1: $n_1=10$. Do the populations have equal variances?",
  "",
  "[[scratchpad]]",
  "",
  "**Step 1: degrees of freedom.**",
  "",
  "$$v_1 = 9$$",
  "",
  "---",
  "",
  "## Worked example 2",
  "",
  "Find F.",
  "",
  "[[Scratchpad]]",
  "",
  "F = 2.8",
].join("\n");

describe("practiceLayout", () => {
  it("finds each pad, its problem and its walkthrough", () => {
    const blocks = splitLessonBlocks(LESSON);
    const { pads, walkthroughOf, padAt } = practiceLayout(blocks);
    expect(pads).toHaveLength(2);
    expect(blocks[pads[0].problemBlock]).toContain("equal variances");
    expect(pads[0].walkthroughBlocks.map((i) => blocks[i])).toEqual(["**Step 1: degrees of freedom.**", "$$v_1 = 9$$"]);
    expect(pads[1].walkthroughBlocks.map((i) => blocks[i])).toEqual(["F = 2.8"]);
    expect(padAt[pads[1].markerBlock]).toBe(1);
    // The rule and the next heading are not part of any walkthrough.
    expect(walkthroughOf[blocks.indexOf("---")]).toBe(-1);
  });

  it("only matches a marker that is the whole block", () => {
    expect(isScratchpadBlock("  [[scratchpad]] ")).toBe(true);
    expect(isScratchpadBlock("Try [[scratchpad]] here")).toBe(false);
  });
});
