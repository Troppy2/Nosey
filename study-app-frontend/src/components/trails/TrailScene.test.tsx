import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TrailScene, type SceneStop } from "./TrailScene";

vi.mock("../../lib/motion", () => ({ prefersReducedMotion: () => true }));
afterEach(cleanup);

const stops: SceneStop[] = [
  { key: "lesson", kind: "lesson", short: "Kojo lesson", status: "Watched", state: "done", glyph: "L", ariaLabel: "Kojo lesson. Watched" },
  { key: "s1", kind: "step", short: "1. Two Sum", status: "Kojo is here", state: "current", glyph: "1", ariaLabel: "Step 1: Two Sum. Kojo is here", redo: { due: false, label: "Redo in 6 days" } },
  { key: "s2", kind: "step", short: "2. 3Sum", status: "Locked", state: "locked", glyph: "2", ariaLabel: "Step 2: 3Sum. Locked: Pass step 1 first" },
  { key: "yarn", kind: "yarn", short: "The yarn", status: "Finish line", state: "locked", glyph: "Y", ariaLabel: "The yarn" },
];

it("renders every stop as a labelled button and reports a pick", () => {
  const onSelect = vi.fn();
  render(<TrailScene stops={stops} orientation="horizontal" variant="path" selected={1} onSelect={onSelect} kojoAt={1} label="Test path" />);
  expect(screen.getByRole("group", { name: "Test path" })).toBeTruthy();
  const locked = screen.getByRole("button", { name: /Locked: Pass step 1 first/ });
  fireEvent.click(locked);
  expect(onSelect).toHaveBeenCalledWith(2);
  expect(screen.getByRole("button", { name: /Kojo is here/ }).getAttribute("aria-pressed")).toBe("true");
  // The waiting redo shows on the signpost.
  expect(screen.getByText("Redo in 6 days")).toBeTruthy();
});

it("finishes a walk at once under reduced motion and floats the reward", () => {
  const onWalkEnd = vi.fn();
  render(
    <TrailScene
      stops={stops}
      orientation="vertical"
      variant="path"
      selected={2}
      onSelect={() => {}}
      kojoAt={2}
      walkFrom={1}
      onWalkEnd={onWalkEnd}
      floatLabel="+1 solved"
      label="Test path"
    />,
  );
  expect(onWalkEnd).toHaveBeenCalledTimes(1);
  expect(screen.getByText("+1 solved")).toBeTruthy();
});
