import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchFolders: vi.fn(), reorderFolders: vi.fn(), bulkFolderAction: vi.fn(),
  createFolder: vi.fn(), updateFolder: vi.fn(), deleteFolder: vi.fn(),
  hasSeenTour: () => true, scopeKey: (key: string) => key,
}));
let refresh: () => Promise<void>;
vi.mock("../lib/api", () => api);
vi.mock("../lib/toast", () => ({ toast: { success: vi.fn() } }));
vi.mock("../lib/usePullToRefresh", () => ({ usePullToRefresh: (fn: () => Promise<void>) => {
  refresh = fn;
  return { pullPx: 0, isRefreshing: false };
} }));
vi.mock("../components/tours/usePageTour", () => ({ usePageTour: () => {} }));
vi.mock("../components/QuizletImportModal", () => ({ QuizletImportModal: () => null }));

import Folders from "./Folders";

const folders = ["Math", "Biology", "History"].map((name, index) => ({
  id: index + 1, name, created_at: "2026-11-01", updated_at: "2026-11-01", test_count: 2, flashcard_count: 8,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function openPage() {
  render(<MemoryRouter><Folders /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Math" });
}

async function chooseAction(name: "Select folders" | "Reorder folders") {
  fireEvent.click(screen.getByRole("button", { name: "Organize folders" }));
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

function shownIds() {
  return [...document.querySelectorAll<HTMLElement>("[data-folder-id]")].map((card) => Number(card.dataset.folderId));
}

beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  Element.prototype.scrollIntoView = vi.fn();
  api.fetchFolders.mockResolvedValue(folders);
  api.bulkFolderAction.mockResolvedValue({ affected: 3 });
  api.reorderFolders.mockImplementation(async (ids: number[]) => ids.map((id) => folders.find((f) => f.id === id)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("folder organization", () => {
  it("keeps commands behind the menu and cancel changes nothing", async () => {
    await openPage();
    expect(screen.queryByRole("button", { name: "Reorder" })).toBeNull();
    await chooseAction("Select folders");
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getAllByRole("checkbox").every((item) => item.getAttribute("aria-checked") === "true")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Done", exact: true }));
    expect(shownIds()).toEqual([1, 2, 3]);
    expect(api.bulkFolderAction).not.toHaveBeenCalled();
  });

  it("requires confirmation, lists names and keeps selection after modal cancellation", async () => {
    await openPage();
    await chooseAction("Select folders");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Math" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Math");
    expect(dialog.textContent).toContain("cannot be undone");
    expect(api.bulkFolderAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("checkbox", { name: "Select Math" }).getAttribute("aria-checked")).toBe("true");
  });

  it("archives all only after confirmation and explains restoration", async () => {
    await openPage();
    await chooseAction("Select folders");
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("dialog").textContent).toContain("restore them in Settings");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive folders" }));
    await screen.findByText("No folders yet");
    expect(api.bulkFolderAction).toHaveBeenCalledWith([1, 2, 3], "archive");
  });

  it("locks confirmation during a request and retains selection on failure", async () => {
    const pending = deferred<{ affected: number }>();
    api.bulkFolderAction.mockReturnValue(pending.promise);
    await openPage();
    await chooseAction("Select folders");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Math" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete folders" }));
    expect((within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    pending.resolve({ affected: 1 });
    await waitFor(() => expect(shownIds()).toEqual([2, 3]));
  });

  it("shows failed bulk action without removing folders", async () => {
    api.bulkFolderAction.mockRejectedValue(new Error("Could not archive"));
    await openPage();
    await chooseAction("Select folders");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Math" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive folders" }));
    await screen.findByText("Could not archive");
    expect(shownIds()).toEqual([1, 2, 3]);
    expect(screen.getByRole("checkbox", { name: "Select Math" }).getAttribute("aria-checked")).toBe("true");
  });

  it("supports keyboard reorder, cancellation and saving", async () => {
    await openPage();
    await chooseAction("Reorder folders");
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Math" }), { key: "ArrowDown" });
    expect(shownIds()).toEqual([2, 1, 3]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
    expect(shownIds()).toEqual([1, 2, 3]);
    expect(api.reorderFolders).not.toHaveBeenCalled();
    await chooseAction("Reorder folders");
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder History" }), { key: "ArrowUp" });
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(api.reorderFolders).toHaveBeenCalledWith([1, 3, 2]));
    await screen.findByRole("button", { name: "Organize folders" });
    expect(shownIds()).toEqual([1, 3, 2]);
  });

  it("keeps the draft when saving fails and lets the user retry", async () => {
    api.reorderFolders.mockRejectedValueOnce(new Error("Save failed"));
    await openPage();
    await chooseAction("Reorder folders");
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Math" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    await screen.findByText("Save failed");
    expect(shownIds()).toEqual([2, 1, 3]);
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    await screen.findByRole("button", { name: "Organize folders" });
  });

  it("ignores refresh responses started before a bulk operation", async () => {
    await openPage();
    const oldFetch = deferred<typeof folders>();
    api.fetchFolders.mockReturnValueOnce(oldFetch.promise);
    const refreshPromise = refresh();
    await chooseAction("Select folders");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Math" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete folders" }));
    await waitFor(() => expect(shownIds()).toEqual([2, 3]));
    oldFetch.resolve(folders);
    await refreshPromise;
    expect(shownIds()).toEqual([2, 3]);
  });
});
