import { describe, expect, it } from "vitest";
import type { AnswerResult } from "../lib/types";
import { reviewBlocks } from "./Results";

function answer(question_id: number, group_id: number | null, part_label: string | null = null): AnswerResult {
  return { question_id, group_id, part_label } as AnswerResult;
}

describe("reviewBlocks", () => {
  it("keeps every part of a problem in one block even when parts arrive apart", () => {
    const blocks = reviewBlocks([
      answer(1, null),
      answer(2, 7, "c"),
      answer(3, 8, "a"),
      answer(4, 7, "a"),
      answer(5, 7, "b"),
    ]);
    expect(blocks.map((b) => b.groupId)).toEqual([null, 7, 8]);
    expect(blocks[1].answers.map((a) => a.question_id)).toEqual([2, 4, 5]);
  });

  it("gives every ungrouped answer its own block", () => {
    expect(reviewBlocks([answer(1, null), answer(2, null)])).toHaveLength(2);
  });
});
