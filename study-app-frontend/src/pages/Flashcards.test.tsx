import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Flashcard } from "../lib/types";
import Flashcards from "./Flashcards";

vi.mock("../lib/api", () => ({
  deleteFlashcard: vi.fn(),
  fetchFlashcards: vi.fn(),
  fetchFolders: vi.fn(),
  isGuestSession: vi.fn(() => true),
  recordFlashcardAttempt: vi.fn(),
}));

vi.mock("../lib/useMobileShell", () => ({
  MOBILE_SHELL_QUERY: "",
  useMobileShell: () => false,
}));

vi.mock("../components/tours/usePageTour", () => ({
  usePageTour: () => undefined,
}));

const { fetchFlashcards, fetchFolders, recordFlashcardAttempt } = await import("../lib/api");
const mockedCards = vi.mocked(fetchFlashcards);
const mockedFolders = vi.mocked(fetchFolders);
const mockedAttempt = vi.mocked(recordFlashcardAttempt);

function makeCard(id: number, front: string): Flashcard {
  return {
    id,
    folder_id: 7,
    front,
    back: `${front} answer`,
    difficulty: 1,
    ease: 2.5,
    interval_days: 0,
    reps: 0,
    lapses: 0,
    due_at: null,
    is_due: false,
    is_new: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    attempt_count: 0,
    correct_count: 0,
  };
}

function renderReview() {
  return render(
    <MemoryRouter initialEntries={["/flashcards/7/review"]}>
      <Routes>
        <Route path="/flashcards/:folderId/review" element={<Flashcards />} />
      </Routes>
    </MemoryRouter>,
  );
}

function press(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...init });
}

beforeEach(() => {
  mockedFolders.mockResolvedValue([]);
  mockedAttempt.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Flashcards review", () => {
  it("rates by keyboard and applies the server's schedule to the deck", async () => {
    const first = makeCard(1, "Mitochondria");
    const second = makeCard(2, "Ribosome");
    mockedCards.mockResolvedValue([first, second]);
    mockedAttempt.mockResolvedValue({
      ...first,
      reps: 1,
      interval_days: 3,
      due_at: "2026-11-05T00:00:00Z",
      is_new: false,
    });

    renderReview();
    expect(await screen.findByText("0 due, 2 new")).toBeTruthy();

    press(" ");
    press("3");

    expect(mockedAttempt).toHaveBeenCalledTimes(1);
    expect(mockedAttempt.mock.calls[0].slice(0, 3)).toEqual([7, 1, "easy"]);
    // The header reads the server's card, which is no longer new.
    expect(await screen.findByText("0 due, 1 new")).toBeTruthy();
    expect(screen.getByText("Card 2 of 2")).toBeTruthy();
  });

  it("re-queues a hard card and ignores a double press and key repeat", async () => {
    const only = makeCard(1, "Krebs cycle");
    mockedCards.mockResolvedValue([only]);
    mockedAttempt.mockResolvedValue({ ...only, lapses: 1, is_new: false });

    renderReview();
    await screen.findByText("0 due, 1 new");

    press(" ");
    // Two presses in the same tick: the second must not rate the card again.
    act(() => {
      press("1");
      press("1");
    });
    press("1", { repeat: true });

    await waitFor(() => expect(mockedAttempt).toHaveBeenCalledTimes(1));
    expect(mockedAttempt.mock.calls[0][2]).toBe("hard");
    // A hard card comes back instead of ending the session.
    expect(screen.queryByText("Session complete")).toBeNull();
    expect(await screen.findByText("Again soon")).toBeTruthy();

    // Once it is back in front it can be rated again.
    press(" ");
    press("2");
    await waitFor(() => expect(mockedAttempt).toHaveBeenCalledTimes(2));
  });

  it("does not rate while typing in an input", async () => {
    mockedCards.mockResolvedValue([makeCard(1, "Osmosis")]);
    renderReview();
    await screen.findByText("0 due, 1 new");

    const input = document.createElement("input");
    document.body.appendChild(input);
    press(" ");
    fireEvent.keyDown(input, { key: "3" });
    expect(mockedAttempt).not.toHaveBeenCalled();
    input.remove();
  });
});
