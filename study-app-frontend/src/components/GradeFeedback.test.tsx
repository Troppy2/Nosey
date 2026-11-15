import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AnswerResult, FeedbackSections } from "../lib/types";
import { GradeFeedback, gradeState } from "./GradeFeedback";

afterEach(cleanup);

const base: FeedbackSections = {
  version: 1,
  note: "",
  what_to_fix: "",
  key_steps: [],
  steps: [],
  final_answer: "",
  graph: "",
};

function answer(is_correct: boolean, flagged_uncertain = false): AnswerResult {
  return { question_id: 1, user_answer: "x", is_correct, flagged_uncertain, is_math: true } as AnswerResult;
}

describe("gradeState", () => {
  it("is check only for a right, flagged answer with a note", () => {
    expect(gradeState(answer(true, true), { ...base, note: "Finish it." })).toBe("check");
    expect(gradeState(answer(true, true), base)).toBe("right");
    expect(gradeState(answer(false, true), { ...base, note: "x" })).toBe("wrong");
  });
});

describe("GradeFeedback", () => {
  it("shows fix, key steps and answer for a wrong part, full solution folded", () => {
    const sections = {
      ...base,
      what_to_fix: "You took the lower tail.",
      key_steps: [{ description: "Upper tail", expression: "1 - 0.9772" }],
      steps: [{ description: "Standardize", expression: "z = 2" }],
      final_answer: "0.0228",
    };
    render(<GradeFeedback answer={answer(false)} sections={sections} />);
    expect(screen.getByText("Wrong")).toBeTruthy();
    expect(screen.getByText("Fix")).toBeTruthy();
    expect(screen.getByText("Key steps")).toBeTruthy();
    expect(screen.getByText("Answer")).toBeTruthy();
    expect(screen.queryByText("Standardize")).toBeNull();
    fireEvent.click(screen.getByText("Full solution"));
    expect(screen.getByText("Standardize")).toBeTruthy();
  });

  it("uses sentence case labels and a note for a right part", () => {
    const { container } = render(
      <GradeFeedback answer={answer(true, true)} sections={{ ...base, note: "Finish it: 0.0228.", final_answer: "0.0228" }} />,
    );
    expect(screen.getByText("Right, check your work")).toBeTruthy();
    expect(container.querySelector(".gf--check")).toBeTruthy();
    expect(screen.queryByText("Fix")).toBeNull();
  });
});
