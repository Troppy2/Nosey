import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SafetyModal } from "./SafetyModal";
import { reportSafety } from "../lib/safetyEvents";

afterEach(cleanup);

describe("SafetyModal (GH #173)", () => {
  it("shows crisis resources for a self-harm notice and closes", () => {
    render(<SafetyModal />);
    act(() => reportSafety("self-harm"));
    expect(screen.getByText(/Call or text 988/)).toBeTruthy();
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByText(/Call or text 988/)).toBeNull();
  });

  it("shows the warning for a refused request", () => {
    render(<SafetyModal />);
    act(() => reportSafety("warning"));
    expect(screen.getByText("That request was blocked")).toBeTruthy();
  });

  it("says a submitted-but-flagged request still went through", () => {
    render(<SafetyModal />);
    act(() => reportSafety("warning-allowed"));
    expect(screen.getByText(/Your work was still submitted/)).toBeTruthy();
  });

  it("keeps the suspension on screen over a later notice", () => {
    render(<SafetyModal />);
    act(() => reportSafety("suspended"));
    act(() => reportSafety("warning"));
    expect(screen.getByText("This account has been suspended")).toBeTruthy();
  });

  it("ignores unknown header values", () => {
    const { container } = render(<SafetyModal />);
    act(() => reportSafety("something-else"));
    expect(container.innerHTML).toBe("");
  });
});
