import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewTheseWidget } from "./ReviewTheseWidget";

afterEach(() => {
  cleanup();
});

const card = (id: number, folder_id: number, folder_name: string, front: string) => ({
  id,
  folder_id,
  folder_name,
  front,
  difficulty: 2,
  due_at: "2026-11-02T10:00:00Z",
  lapses: 0,
});

describe("ReviewTheseWidget (Flashcards due)", () => {
  it("renders the empty state when nothing is due", () => {
    render(
      <MemoryRouter>
        <ReviewTheseWidget summary={{ total_due: 0, folders: [], cards: [] }} />
      </MemoryRouter>,
    );

    expect(screen.getByText("All caught up")).toBeTruthy();
    expect(screen.getByText("Go to flashcards")).toBeTruthy();
  });

  it("previews the next card and starts a due-only session for the top folder", () => {
    render(
      <MemoryRouter>
        <ReviewTheseWidget
          summary={{
            total_due: 2,
            folders: [{ folder_id: 101, name: "Biology", due: 2 }],
            cards: [card(1, 101, "Biology", "Mitochondria role"), card(2, 101, "Biology", "Ribosome role")],
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("2 cards")).toBeTruthy();
    expect(screen.getByText("Mitochondria role")).toBeTruthy();
    const cta = screen.getByRole("link", { name: "Review 2 cards" });
    expect(cta.getAttribute("href")).toBe("/flashcards/101/review?due=1");
    expect(screen.queryByText("Also due")).toBeNull();
  });

  it("lists other folders with their own due-only links", () => {
    render(
      <MemoryRouter>
        <ReviewTheseWidget
          summary={{
            total_due: 5,
            folders: [
              { folder_id: 101, name: "Biology", due: 3 },
              { folder_id: 202, name: "Chemistry", due: 2 },
            ],
            cards: [card(1, 101, "Biology", "Mitochondria role")],
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("5 cards")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review 3 cards" })).toBeTruthy();
    expect(screen.getByText("Also due")).toBeTruthy();
    expect(screen.getByText("Chemistry").closest("a")?.getAttribute("href")).toBe("/flashcards/202/review?due=1");
  });

  it("renders a skeleton and no empty state while loading", () => {
    render(
      <MemoryRouter>
        <ReviewTheseWidget summary={undefined} />
      </MemoryRouter>,
    );

    expect(screen.queryByText("All caught up")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading due flashcards" })).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it("shows an error with a retry instead of the empty state when the fetch failed", () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ReviewTheseWidget summary={null} onRetry={onRetry} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Couldn't load your due cards.")).toBeTruthy();
    expect(screen.queryByText("All caught up")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
