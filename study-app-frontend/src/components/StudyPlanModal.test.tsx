import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudyPlanDetail, StudyPlanItem, StudyPlanItemInput } from "../lib/types";

const api = vi.hoisted(() => ({
  fetchStudyPlans: vi.fn(),
  fetchStudyPlan: vi.fn(),
  fetchStudyPlansCatalog: vi.fn(),
  replaceStudyPlanItems: vi.fn(),
  updateStudyPlan: vi.fn(),
  deleteStudyPlan: vi.fn(),
  createStudyPlan: vi.fn(),
  generateStudyPlanDraft: vi.fn(),
}));

vi.mock("../lib/api", () => api);
vi.mock("../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));
vi.mock("./KojoMascot", () => ({ default: () => null }));

import { StudyPlanModal } from "./StudyPlanModal";
import { todayString } from "../lib/studyPlan";

const today = todayString();

function makePlan(items: Partial<StudyPlanItem>[]): StudyPlanDetail {
  return {
    id: 1,
    title: "Bio midterm",
    exam_date: null,
    is_pinned: true,
    created_at: "2026-11-01T00:00:00",
    updated_at: "2026-11-01T00:00:00",
    items: items.map((it, i) => ({
      id: 100 + i,
      plan_id: 1,
      position: i,
      kind: "free_text",
      label: `Item ${i}`,
      due_date: today,
      done: false,
      created_at: "2026-11-01T00:00:00",
      ...it,
    })),
  };
}

// What the server would send back for a replace: inputs become rows, new
// ones get fresh ids.
let serverId = 500;
function echo(inputs: StudyPlanItemInput[]): StudyPlanDetail {
  return makePlan(inputs.map((it, i) => ({ ...it, id: it.id ?? serverId++, position: i, done: Boolean(it.done) })));
}

function setup(plan: StudyPlanDetail) {
  api.fetchStudyPlans.mockResolvedValue([{ ...plan, total_items: plan.items.length, done_items: 0 }]);
  api.fetchStudyPlan.mockResolvedValue(plan);
  api.fetchStudyPlansCatalog.mockResolvedValue({ tests: [], modules: [], flashcards: [], leetcode: [], system_design: [], mock_interview: [] });
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <StudyPlanModal initialPlanId={plan.id} onClose={onClose} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return { onClose, onChanged };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudyPlanModal", () => {
  it("ticks an item by saving the whole list with it done", async () => {
    api.replaceStudyPlanItems.mockImplementation(async (_id: number, items: StudyPlanItemInput[]) => echo(items));
    setup(makePlan([{ label: "Reread chapter 4" }]));

    fireEvent.click(await screen.findByRole("checkbox", { name: 'Mark "Reread chapter 4" done' }));

    await waitFor(() => expect(api.replaceStudyPlanItems).toHaveBeenCalledTimes(1));
    expect(api.replaceStudyPlanItems.mock.calls[0][1]).toEqual([expect.objectContaining({ id: 100, done: true })]);
  });

  it("does not create a quickly added item twice when saves overlap", async () => {
    let releaseFirst: () => void = () => {};
    api.replaceStudyPlanItems
      .mockImplementationOnce(
        (_id: number, items: StudyPlanItemInput[]) =>
          new Promise<StudyPlanDetail>((resolve) => {
            releaseFirst = () => resolve(echo(items));
          }),
      )
      .mockImplementation(async (_id: number, items: StudyPlanItemInput[]) => echo(items));
    setup(makePlan([]));

    const input = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(input, { target: { value: "First" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.change(input, { target: { value: "Second" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(api.replaceStudyPlanItems).toHaveBeenCalledTimes(1));
    releaseFirst();
    await waitFor(() => expect(api.replaceStudyPlanItems).toHaveBeenCalledTimes(2));

    // A save sends the newest local list, so the first save already created
    // both rows. The second save must send their server ids, not create them again.
    const first = api.replaceStudyPlanItems.mock.calls[0][1] as StudyPlanItemInput[];
    const second = api.replaceStudyPlanItems.mock.calls[1][1] as StudyPlanItemInput[];
    expect(first.map((it) => it.id)).toEqual([undefined, undefined]);
    expect(second.map((it) => it.label)).toEqual(["First", "Second"]);
    expect(second.every((it) => typeof it.id === "number" && it.id > 0)).toBe(true);
    expect(new Set(second.map((it) => it.id)).size).toBe(2);
  });

  it("renames in place, and Escape cancels the rename without closing the modal", async () => {
    api.replaceStudyPlanItems.mockImplementation(async (_id: number, items: StudyPlanItemInput[]) => echo(items));
    const { onClose } = setup(makePlan([{ label: "Old name" }]));

    fireEvent.click(await screen.findByRole("button", { name: "Edit Old name" }));
    const field = screen.getByRole("textbox", { name: "Item name" });
    fireEvent.change(field, { target: { value: "Changed" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(api.replaceStudyPlanItems).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit Old name" }));
    const again = screen.getByRole("textbox", { name: "Item name" });
    fireEvent.change(again, { target: { value: "New name" } });
    fireEvent.keyDown(again, { key: "Enter" });
    await waitFor(() => expect(api.replaceStudyPlanItems).toHaveBeenCalledTimes(1));
    expect(api.replaceStudyPlanItems.mock.calls[0][1]).toEqual([expect.objectContaining({ id: 100, label: "New name" })]);
  });

  it("puts the item back when the save fails", async () => {
    api.replaceStudyPlanItems.mockRejectedValue(new Error("offline"));
    setup(makePlan([{ label: "Keep me" }]));

    fireEvent.click(await screen.findByRole("button", { name: "Edit Keep me" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.replaceStudyPlanItems).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Keep me" })).toBeTruthy());
  });
});
