import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLectures, requestLecture } from "../lib/api";
import type { LectureListResponse } from "../lib/types";
import { LectureLibrary } from "./LectureLibrary";

vi.mock("../lib/api", () => ({ fetchLectures: vi.fn(), requestLecture: vi.fn() }));
vi.mock("../lib/toast", () => ({ toast: { success: vi.fn() } }));
vi.mock("./KojoWalkthrough", () => ({
  KojoLecture: ({ slug, onTryProblem }: { slug: string; onTryProblem: (slug: string) => void }) => (
    <div role="dialog" aria-label={slug}><button onClick={() => onTryProblem("valid-palindrome")}>Practice from player</button></div>
  ),
}));

const data: LectureListResponse = {
  lectures: [
    { slug: "two-pointers", title: "Two pointers", category: "arrays", summary: "Move inward.", problem_slug: "valid-palindrome", problem_title: "Valid Palindrome", source: "curated", ready: true },
    { slug: "sliding-window", title: "Sliding window", category: "arrays", summary: "Grow a window.", problem_slug: "longest-substring", problem_title: "Longest Substring", source: "community", ready: true },
    { slug: "bfs", title: "Breadth-first search", category: "graphs", summary: "Explore by level.", problem_slug: "islands", problem_title: "Number of Islands", source: "curated", ready: false },
  ],
  requests: [],
  requests_left_today: 1,
};
const labels = new Map([["arrays", "Arrays & strings"], ["graphs", "Graphs"]]);

beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchLectures).mockResolvedValue(structuredClone(data)); });
afterEach(cleanup);

it("opens the selected ready lecture and preserves the player practice callback", async () => {
  const practice = vi.fn();
  render(<LectureLibrary categoryLabels={labels} onTryProblem={practice} />);
  const windowRow = await screen.findByRole("button", { name: /Sliding window.*Longest Substring/ });
  fireEvent.click(windowRow);
  fireEvent.click(screen.getByRole("button", { name: "Watch lecture" }));
  expect(screen.getByRole("dialog", { name: "sliding-window" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Practice from player" }));
  expect(practice).toHaveBeenCalledWith("valid-palindrome");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps initial lecture links opening the player", () => {
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} initialLecture="sliding-window" />);
  expect(screen.getByRole("dialog", { name: "sliding-window" })).toBeTruthy();
});

it("filters by worked problem and recovers after a zero-result search", async () => {
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  await screen.findByRole("button", { name: /Two pointers.*Valid Palindrome/ });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search lectures" }), { target: { value: "Longest Substring" } });
  expect(screen.queryByRole("button", { name: /Two pointers.*Valid Palindrome/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Sliding window.*Longest Substring/ }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
  expect(screen.getByText("No matching lectures")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Watch lecture" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByRole("button", { name: /Two pointers.*Valid Palindrome/ })).toBeTruthy();
});

it("shows upcoming lecture details while preventing playback and practice", async () => {
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Breadth-first search.*Coming soon/ }));
  const watch = screen.getByRole("button", { name: "Coming soon" }) as HTMLButtonElement;
  expect(watch.disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Try the worked problem" })).toBeNull();
});

it("retains a failed request for retry and stops requests at the daily limit", async () => {
  vi.mocked(requestLecture).mockRejectedValueOnce(new Error("Try again later")).mockResolvedValueOnce({ id: 1, topic: "Segment trees", status: "pending", lecture_slug: null });
  vi.mocked(fetchLectures).mockResolvedValueOnce(structuredClone(data)).mockResolvedValue({ ...data, requests_left_today: 0 });
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  await screen.findByRole("button", { name: /Two pointers.*Valid Palindrome/ });
  fireEvent.click(screen.getByRole("button", { name: "Request a topic" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Topic" }), { target: { value: "Segment trees" } });
  fireEvent.click(screen.getByRole("button", { name: "Request" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Try again later");
  expect((screen.getByRole("textbox", { name: "Topic" }) as HTMLInputElement).value).toBe("Segment trees");
  fireEvent.click(screen.getByRole("button", { name: "Request" }));
  await waitFor(() => expect(screen.getByText("You've used today's requests. Try again tomorrow.")).toBeTruthy());
  expect((screen.getByRole("button", { name: "Request" }) as HTMLButtonElement).disabled).toBe(true);
});

describe("library recovery", () => {
  it("retries a failed initial load", async () => {
    vi.mocked(fetchLectures).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(data);
    render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
    await screen.findByText("Offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Two pointers.*Valid Palindrome/ })).toBeTruthy();
    expect(screen.queryByText("Offline")).toBeNull();
  });
});
