import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerResult } from "../lib/types";
import { RemakePanel } from "./RemakePanel";

afterEach(cleanup);

function answer(extra: Partial<AnswerResult>): AnswerResult {
  return {
    question_id: 7,
    user_answer: "Normal X",
    is_correct: false,
    flagged_uncertain: false,
    question_type: "MCQ",
    options: ["Binomial count", "Normal X"],
    remake_available: true,
    ...extra,
  } as AnswerResult;
}

describe("RemakePanel", () => {
  it("offers a remake and a show-answer that asks first", () => {
    render(<RemakePanel answer={answer({})} attemptId={1} onUpdated={vi.fn()} />);
    expect(screen.getByText("Remake for half credit")).toBeTruthy();
    fireEvent.click(screen.getByText("Show answer"));
    expect(screen.getByText("Show the answer?")).toBeTruthy();
  });

  it("needs a new pick and both reflections before it can be sent", () => {
    render(<RemakePanel answer={answer({})} attemptId={1} onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByText("Remake for half credit"));
    expect(screen.getByText("your first pick")).toBeTruthy();
    const submit = screen.getByText("Submit remake").closest("button") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Binomial count/ }));
    fireEvent.change(screen.getByLabelText("What I got wrong"), { target: { value: "X was continuous." } });
    fireEvent.change(screen.getByLabelText("What I got right"), { target: { value: "The 0.5 shift." } });
    expect(submit.disabled).toBe(false);
  });

  it("shows the result and one appeal after no credit", () => {
    render(
      <RemakePanel
        answer={answer({ remake_available: false, remake_status: "no_credit", remake_feedback: { version: 1, note: "", what_to_fix: "Still the lower tail.", key_steps: [], steps: [], final_answer: "", graph: "" } })}
        attemptId={1}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText("No credit this time")).toBeTruthy();
    expect(screen.getByText("Ask Kojo to look again")).toBeTruthy();
  });

  it("shows nothing once the answer was revealed", () => {
    const { container } = render(
      <RemakePanel answer={answer({ remake_available: false, answer_revealed: true })} attemptId={1} onUpdated={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
