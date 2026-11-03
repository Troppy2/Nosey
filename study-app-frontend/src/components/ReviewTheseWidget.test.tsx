import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewTheseWidget } from "./ReviewTheseWidget";

afterEach(() => {
  cleanup();
});

describe("ReviewTheseWidget", () => {
  it("renders empty state when total_due is 0", () => {
    render(
      <MemoryRouter>
        <ReviewTheseWidget
          summary={{
            total_due: 0,
            folders: [],
            cards: [],
          }}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("All caught up!")).toBeTruthy();
    expect(screen.getByText("Go to Flashcards")).toBeTruthy();
  });

  it("renders cards and folder link when cards are due", () => {
    render(
      <MemoryRouter>
        <ReviewTheseWidget
          summary={{
            total_due: 2,
            folders: [{ folder_id: 101, name: "Biology", due: 2 }],
            cards: [
              {
                id: 1,
                folder_id: 101,
                folder_name: "Biology",
                front: "Mitochondria role",
                difficulty: 3,
                due_at: "2026-11-02T10:00:00Z",
                lapses: 1,
              },
              {
                id: 2,
                folder_id: 101,
                folder_name: "Biology",
                front: "Ribosome role",
                difficulty: 2,
                due_at: "2026-11-02T11:00:00Z",
                lapses: 0,
              },
            ],
          }}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("2 cards due")).toBeTruthy();
    expect(screen.getByText("Review due cards")).toBeTruthy();
    expect(screen.getAllByText("Biology").length).toBeGreaterThan(0);
    expect(screen.getByText("Mitochondria role")).toBeTruthy();
    expect(screen.getByText("Ribosome role")).toBeTruthy();
  });

  it("renders a skeleton and no empty state while loading", () => {
    render(
      <MemoryRouter>
        <ReviewTheseWidget summary={undefined} />
      </MemoryRouter>
    );

    expect(screen.queryByText("All caught up!")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading review cards" })).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it("renders a quiet error state instead of the empty state when the fetch failed", () => {
    render(
      <MemoryRouter>
        <ReviewTheseWidget summary={null} />
      </MemoryRouter>
    );

    expect(screen.getByText("Couldn't load your due cards right now.")).toBeTruthy();
    expect(screen.queryByText("All caught up!")).toBeNull();
  });
});
