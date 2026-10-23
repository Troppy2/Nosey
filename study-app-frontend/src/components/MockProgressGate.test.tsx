import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const hydration = { progress: null as unknown, ready: true };
vi.mock("../lib/useMockProgress", () => ({ useMockProgress: () => hydration }));
vi.mock("../lib/api", () => ({
  getMockInterviewSession: vi.fn(async (id: number) => ({
    id,
    company: "google",
    stages_config: '["stage2","stage3"]',
    status: "pending",
  })),
}));

const { MockProgressGate } = await import("./MockProgressGate");

// The gate holds its loader for a minimum time so a fast restore is not a flicker.
const LONG = { timeout: 4000 };

function Page() {
  const state = useLocation().state as { session?: { id: number }; selectedStages?: string[] } | null;
  return <div>page for {state?.session?.id ?? "nothing"}: {(state?.selectedStages ?? []).join(",")}</div>;
}

function renderAt(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/mock-interview/7/stage2", state }]}>
      <Routes>
        <Route
          path="/mock-interview/:sessionId/stage2"
          element={<MockProgressGate sessionId={7} label="Loading" render={() => <Page />} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  hydration.progress = null;
});

describe("MockProgressGate", () => {
  it("fetches the session when a run is opened with no snapshot and no router state", async () => {
    renderAt();
    expect(await screen.findByText("page for 7: stage2,stage3", {}, LONG)).toBeTruthy();
  });

  it("uses the session setup passed without fetching", async () => {
    renderAt({ session: { id: 7 }, selectedStages: ["stage2"] });
    expect(await screen.findByText("page for 7: stage2", {}, LONG)).toBeTruthy();
  });

  it("renders once the loader has been on screen long enough when a snapshot exists", async () => {
    hydration.progress = { sessionId: 7 };
    renderAt();
    expect(await screen.findByText("page for nothing:", {}, LONG)).toBeTruthy();
  });
});
