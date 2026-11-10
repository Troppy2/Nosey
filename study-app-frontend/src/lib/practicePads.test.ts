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
    expect(pads[0].problemText).toBe("Sample 1: $n_1=10$. Do the populations have equal variances?");
    expect(pads[0].walkthroughBlocks.map((i) => blocks[i])).toEqual(["**Step 1: degrees of freedom.**", "$$v_1 = 9$$"]);
    expect(pads[1].walkthroughBlocks.map((i) => blocks[i])).toEqual(["F = 2.8"]);
    expect(padAt[pads[1].markerBlock]).toBe(1);
    // The rule and the next heading are not part of any walkthrough.
    expect(walkthroughOf[blocks.indexOf("---")]).toBe(-1);
  });

  it("gives the pad the whole multi-part problem, not just its last part", () => {
    const lesson = [
      "### Topic: Poisson, then geometric",
      "",
      "**Problem 1.** A batch has 200 items.",
      "",
      "(a) Find P(flagged).",
      "",
      "(b) Expected batches to the first flag.",
      "",
      "(c) P(first flag is the 3rd batch).",
      "",
      "[[scratchpad]]",
      "",
      "**(a)** 0.3233",
      "",
      "---",
      "",
      "**Problem 2.** Packs of 25.",
      "",
      "[[scratchpad]]",
      "",
      "**(a)** 0.0228",
    ].join("\n");
    const { pads } = practiceLayout(splitLessonBlocks(lesson));
    expect(pads[0].problemText).toBe(
      "**Problem 1.** A batch has 200 items.\n\n(a) Find P(flagged).\n\n(b) Expected batches to the first flag.\n\n(c) P(first flag is the 3rd batch).",
    );
    expect(pads[1].problemText).toBe("**Problem 2.** Packs of 25.");
  });

  it("only matches a marker that is the whole block", () => {
    expect(isScratchpadBlock("  [[scratchpad]] ")).toBe(true);
    expect(isScratchpadBlock("Try [[scratchpad]] here")).toBe(false);
  });
});
