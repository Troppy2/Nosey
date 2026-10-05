import { describe, expect, it } from "vitest";
import { buildScreens, fullQuestionText, screenAnchor } from "./questionScreens";
import type { Question, QuestionGroup } from "./types";

const setup: QuestionGroup = { id: 7, label: "3", stem: "Let $A = I_2$." };

function q(id: number, group?: QuestionGroup, part?: string): Question {
  return { id, type: "FRQ", question_text: `Q${id}`, options: [], group: group ?? null, part_label: part ?? null };
}

describe("buildScreens", () => {
  it("puts a problem's parts on one screen and every other question on its own", () => {
    const questions = [q(1), q(2, setup, "a"), q(3, setup, "b"), q(4, setup, "c"), q(5)];
    const built = buildScreens(questions);
    expect(built.screens).toEqual([[0], [1, 2, 3], [4]]);
    expect(built.screenOf).toEqual([0, 1, 1, 1, 2]);
  });

  it("keeps two problems apart even when they are next to each other", () => {
    const other: QuestionGroup = { id: 8, label: "4", stem: "Let $B = 0$." };
    const built = buildScreens([q(1, setup, "a"), q(2, setup, "b"), q(3, other, "a")]);
    expect(built.screens).toEqual([[0, 1], [2]]);
  });

  it("is one screen per question for a test with no problems", () => {
    expect(buildScreens([q(1), q(2), q(3)]).screens).toEqual([[0], [1], [2]]);
  });
});

describe("screenAnchor", () => {
  it("lands a position inside a problem on the problem's first part", () => {
    const built = buildScreens([q(1), q(2, setup, "a"), q(3, setup, "b")]);
    expect(screenAnchor(built, 2)).toBe(1);
    expect(screenAnchor(built, 0)).toBe(0);
    // A pending slot past the loaded questions is left alone.
    expect(screenAnchor(built, 3)).toBe(3);
  });
});

describe("fullQuestionText", () => {
  it("puts the setup in front of a part", () => {
    expect(fullQuestionText(q(2, setup, "b"))).toBe("Let $A = I_2$.\n\n(b) Q2");
    expect(fullQuestionText(q(1))).toBe("Q1");
  });
});
