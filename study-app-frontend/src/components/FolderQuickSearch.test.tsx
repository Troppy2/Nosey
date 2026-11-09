import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FolderQuickSearch } from "./FolderQuickSearch";
import type { FolderSearchResponse } from "../lib/types";

const search = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({ searchFoldersAndTests: search, scopeKey: (key: string) => key }));
const data: FolderSearchResponse = { has_more: false, results: [
  { kind: "folder", id: 3, title: "Biology", folder_id: 3, folder_name: null, subject: "Science" },
  { kind: "test", id: 8, title: "Biology exam", folder_id: 3, folder_name: "Biology" },
] };
function mount(disabled = false) {
  render(<MemoryRouter initialEntries={["/folders"]}><Routes>
    <Route path="/folders" element={<FolderQuickSearch disabled={disabled} activeFolderIds={[3]} />} />
    <Route path="/folders/:id" element={<p>Folder destination</p>} />
    <Route path="/test/:id" element={<p>Test destination</p>} />
  </Routes></MemoryRouter>);
}
function open() {
  const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  return screen.getByRole("combobox");
}
async function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
}
beforeEach(() => {
  vi.useFakeTimers();
  const store = new Map<string, string>(); // This jsdom setup exposes no localStorage.
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  });
  search.mockReset().mockResolvedValue(data);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("overrides print on both platforms, makes no empty request, and closes with Escape", async () => {
  mount();
  screen.getByRole("button", { name: /Search/ }).focus();
  fireEvent.click(screen.getByRole("button", { name: /Search/ }));
  expect(screen.getByRole("combobox")).toBe(document.activeElement);
  expect(search).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Search/ }));
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", metaKey: true, cancelable: true })); });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("debounces, labels results, and opens tests with the keyboard", async () => {
  mount();
  let input!: HTMLElement;
  input = open();
  fireEvent.change(input, { target: { value: "b" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  fireEvent.change(input, { target: { value: "bio" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(149); });
  expect(search).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(search).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("option")).toHaveLength(2);
  const [folder, test] = screen.getAllByRole("option");
  expect(folder.textContent).toContain("Folder · Science");
  expect(test.textContent).toContain("Test · in Biology");
  expect(folder.querySelector("mark")?.textContent).toBe("Bio");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("Test destination")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  const print = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, cancelable: true });
  window.dispatchEvent(print);
  expect(print.defaultPrevented).toBe(false); // Shortcut removed on route departure.
});

it("cancels and ignores stale requests, reuses repeat queries, and navigates on click", async () => {
  let resolve!: (value: FolderSearchResponse) => void;
  search.mockImplementationOnce(() => new Promise<FolderSearchResponse>((r) => { resolve = r; }));
  mount();
  open();
  const input = screen.getByRole("combobox");
  await type(input, "old");
  const signal: AbortSignal = search.mock.calls[0][1];
  fireEvent.change(input, { target: { value: "biology" } });
  expect(signal.aborted).toBe(true);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.queryByText("Folder destination")).toBeNull();
  await act(async () => { resolve({ results: [], has_more: false }); await vi.advanceTimersByTimeAsync(150); });
  expect(screen.getAllByRole("option")).toHaveLength(2);
  await type(input, "");
  await type(input, "biology");
  expect(search).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getAllByRole("option")[0]);
  expect(screen.getByText("Folder destination")).toBeTruthy();
});

it("supports error retry, empty results, and abort on close", async () => {
  search.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ results: [], has_more: false });
  mount();
  open();
  await type(screen.getByRole("combobox"), "none");
  expect(screen.getByRole("alert").textContent).toContain("Offline");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(screen.getByRole("status").textContent).toContain("No results");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "next" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  const signal: AbortSignal = search.mock.calls[2][1];
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  expect(signal.aborted).toBe(true);
});

it("reserves the print shortcut without stacking over another modal", () => {
  mount(true);
  const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps old results on screen while loading and lists recent picks for an empty query", async () => {
  let resolve!: (value: FolderSearchResponse) => void;
  mount();
  let input = open();
  expect(screen.getByRole("status").textContent).toContain("Type to find");
  await type(input, "bio");
  search.mockImplementationOnce(() => new Promise<FolderSearchResponse>((r) => { resolve = r; }));
  await type(input, "biol");
  expect(screen.getAllByRole("option")).toHaveLength(2); // Stale, not blank.
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.queryByText("Folder destination")).toBeNull(); // Never opens a stale pick.
  await act(async () => { resolve(data); });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("Folder destination")).toBeTruthy();
  cleanup();
  mount();
  input = open();
  expect(screen.getByRole("status").textContent).toBe("Recent");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([expect.stringContaining("Biology")]);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("Folder destination")).toBeTruthy();
});

it("never opens stale results on click or after a newer request fails", async () => {
  mount();
  const input = open();
  await type(input, "bio");
  search.mockRejectedValueOnce(new Error("Offline"));
  fireEvent.change(input, { target: { value: "chemistry" } });
  fireEvent.click(screen.getAllByRole("option")[0]);
  expect(screen.queryByText("Folder destination")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(screen.getByRole("alert").textContent).toContain("Offline");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.queryByText("Folder destination")).toBeNull();
});

it("excludes archived or invalid recents without fetching for empty input", () => {
  localStorage.setItem("nosey_quick_search_recent", JSON.stringify([
    null, {}, { ...data.results[0], folder_id: 99, title: "Archived" }, data.results[0],
  ]));
  mount();
  open();
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.queryByText("Archived")).toBeNull();
  expect(search).not.toHaveBeenCalled();
});
