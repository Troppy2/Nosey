import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SD_CONCEPTS } from "../data/systemDesign";
import SystemDesign from "./SystemDesign";

const settings = { betaMode: true };

vi.mock("../lib/useSettings", () => ({
  useSettings: () => settings,
  SETTINGS_KEYS: {},
}));

vi.mock("../lib/api", () => ({
  getSystemDesignProgress: vi.fn(),
}));

const { getSystemDesignProgress } = await import("../lib/api");
const mockedProgress = vi.mocked(getSystemDesignProgress);

function renderTrack() {
  return render(
    <MemoryRouter initialEntries={["/system-design"]}>
      <Routes>
        <Route path="/system-design" element={<SystemDesign />} />
        <Route path="/leetcode" element={<div>KojoCode landing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const EMPTY_PROGRESS = { concepts: {} };

beforeEach(() => {
  settings.betaMode = true;
  mockedProgress.mockReset();
  mockedProgress.mockResolvedValue(EMPTY_PROGRESS);
});

afterEach(() => {
  cleanup();
});

describe("SystemDesign track page", () => {
  it("renders a card per concept in order", async () => {
    renderTrack();
    for (const concept of SD_CONCEPTS) {
      expect(await screen.findByText(concept.title)).toBeTruthy();
    }
    const headings = screen.getAllByTestId("sd-concept-title").map((node) => node.textContent);
    expect(headings).toEqual(SD_CONCEPTS.map((concept) => concept.title));
  });

  it("shows five sub-module chips per concept", async () => {
    renderTrack();
    await screen.findByText(SD_CONCEPTS[0].title);
    const chips = screen.getAllByTestId(`sd-chip-${SD_CONCEPTS[0].id}`);
    expect(chips).toHaveLength(5);
  });

  it("marks only the sub-modules the server reports as done", async () => {
    mockedProgress.mockResolvedValue({
      concepts: {
        [SD_CONCEPTS[0].id]: {
          notesDone: true,
          videoDone: false,
          visualizerDone: false,
          projectDone: false,
          quizDone: false,
          quizBestScore: null,
          completedAt: null,
        },
      },
    });
    renderTrack();

    await waitFor(() => {
      const chips = screen.getAllByTestId(`sd-chip-${SD_CONCEPTS[0].id}`);
      expect(chips.filter((chip) => chip.dataset.done === "true")).toHaveLength(1);
    });
    const chips = screen.getAllByTestId(`sd-chip-${SD_CONCEPTS[0].id}`);
    expect(chips[0].dataset.done).toBe("true");
    expect(chips.slice(1).every((chip) => chip.dataset.done === "false")).toBe(true);
  });

  it("shows a loading state before progress resolves", () => {
    let resolve: (value: typeof EMPTY_PROGRESS) => void = () => {};
    mockedProgress.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderTrack();
    expect(screen.getByTestId("sd-track-loading")).toBeTruthy();
    resolve(EMPTY_PROGRESS);
  });

  it("shows the error detail when progress fails", async () => {
    mockedProgress.mockRejectedValue(new Error("Could not load your System Design progress."));
    renderTrack();
    expect(await screen.findByText(/Could not load your System Design progress\./)).toBeTruthy();
  });

  it("still renders the track when the progress request fails", async () => {
    mockedProgress.mockRejectedValue(new Error("offline"));
    renderTrack();
    expect(await screen.findByText(SD_CONCEPTS[0].title)).toBeTruthy();
  });

  it("redirects to /leetcode when betaMode is false", async () => {
    settings.betaMode = false;
    renderTrack();
    expect(await screen.findByText("KojoCode landing")).toBeTruthy();
  });
});

describe("SystemDesign track layout", () => {
  it("uses the app's back control rather than a stray text link", async () => {
    renderTrack();
    const back = await screen.findByLabelText(/back to kojocode/i);
    expect(back.getAttribute("href")).toBe("/leetcode");
    expect(back.classList.contains("flash-back-btn")).toBe(true);
  });

  it("frames the page with the shared page-narrow width", async () => {
    const { container } = renderTrack();
    await screen.findByText(SD_CONCEPTS[0].title);
    const root = container.querySelector(".sd-page") as HTMLElement;
    expect(root.classList.contains("page")).toBe(true);
    expect(root.classList.contains("page-narrow")).toBe(true);
  });

  it("names the next sub-module on each card", async () => {
    mockedProgress.mockResolvedValue({
      concepts: {
        [SD_CONCEPTS[0].id]: {
          notesDone: true,
          videoDone: false,
          visualizerDone: false,
          projectDone: false,
          quizDone: false,
          quizBestScore: null,
          completedAt: null,
        },
      },
    });
    renderTrack();
    expect(await screen.findByText(/continue with video/i)).toBeTruthy();
  });

  it("counts progress in words rather than only a bar", async () => {
    renderTrack();
    expect((await screen.findAllByText(/0 of 5 done/i)).length).toBeGreaterThan(0);
  });
});
