import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLectures, requestLecture } from "../lib/api";
import type { LectureListResponse } from "../lib/types";
import { LectureLibrary } from "./LectureLibrary";

vi.mock("../lib/api", () => ({ fetchLectures: vi.fn(), requestLecture: vi.fn(), scopeKey: (key: string) => key }));
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

beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); vi.mocked(fetchLectures).mockResolvedValue(structuredClone(data)); });
afterEach(cleanup);

it("opens the selected ready lecture and preserves the player practice callback", async () => {
  const practice = vi.fn();
  render(<LectureLibrary categoryLabels={labels} onTryProblem={practice} />);
  const windowRow = await screen.findByRole("button", { name: /Sliding window.*Longest Substring/ });
  fireEvent.click(windowRow);
  fireEvent.click(within(screen.getByRole("complementary", { name: "Selected lecture" })).getByRole("button", { name: "Watch lecture" }));
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
  await screen.findByRole("button", { name: /All lectures/ });
  fireEvent.click(screen.getByRole("button", { name: /All lectures/ }));
  fireEvent.click(screen.getByRole("button", { name: /Breadth-first search.*Coming soon/ }));
  const preview = within(screen.getByRole("complementary", { name: "Selected lecture" }));
  expect(preview.queryByRole("button", { name: "Watch lecture" })).toBeNull();
  expect(preview.queryByRole("button", { name: "Try worked problem" })).toBeNull();
});

it("retains a failed request for retry and stops requests at the daily limit", async () => {
  vi.mocked(requestLecture).mockRejectedValueOnce(new Error("Try again later")).mockResolvedValueOnce({ id: 1, topic: "Segment trees", status: "pending", lecture_slug: null });
  vi.mocked(fetchLectures).mockResolvedValueOnce(structuredClone(data)).mockResolvedValue({ ...data, requests_left_today: 0 });
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  await screen.findByRole("button", { name: /Two pointers.*Valid Palindrome/ });
  fireEvent.click(screen.getByRole("button", { name: "Request a lecture" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Topic" }), { target: { value: "Segment trees" } });
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Try again later");
  expect((screen.getByRole("textbox", { name: "Topic" }) as HTMLInputElement).value).toBe("Segment trees");
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  await waitFor(() => expect(screen.getByText("No requests left. More become available within 24 hours.")).toBeTruthy());
  expect((screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement).disabled).toBe(true);
});

describe("library recovery", () => {
  it("retries a failed initial load", async () => {
    vi.mocked(fetchLectures).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(data);
    render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
    await screen.findByText("Offline");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Two pointers.*Valid Palindrome/ })).toBeTruthy();
    expect(screen.queryByText("Offline")).toBeNull();
  });
});

it("keeps lecture details beside their selected row and offers upcoming search matches", async () => {
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  await screen.findByRole("button", { name: /Two pointers.*Valid Palindrome/ });
  expect(screen.queryByRole("button", { name: /Breadth-first search.*Coming soon/ })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Number of Islands" } });
  fireEvent.click(screen.getByRole("button", { name: "Check all lectures" }));
  expect(screen.getByRole("button", { name: /Breadth-first search.*Coming soon/ })).toBeTruthy();
});

it("restores lecture filters and selection after leaving the library", async () => {
  const first = render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Sliding window.*Longest Substring/ }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Longest" } });
  first.unmount();
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Longest");
  expect((await screen.findByRole("button", { name: /Sliding window.*Longest Substring/ })).getAttribute("aria-pressed")).toBe("true");
});

it("returns focus after closing a request and explains the request timing", async () => {
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  await screen.findByRole("button", { name: /Two pointers.*Valid Palindrome/ });
  const trigger = screen.getByRole("button", { name: "Request a lecture" });
  fireEvent.click(trigger);
  expect(screen.getByText(/Suggest a topic for a future lecture/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close lecture request" }));
  expect(document.activeElement).toBe(trigger);
});

it("keeps the player open when its worked problem cannot be opened", async () => {
  render(<LectureLibrary categoryLabels={labels} onTryProblem={() => false} initialLecture="two-pointers" />);
  fireEvent.click(screen.getByRole("button", { name: "Practice from player" }));
  expect(screen.getByRole("dialog", { name: "two-pointers" })).toBeTruthy();
});

it("shows request history from the header and links recorded topics to their lecture", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(fetchLectures).mockResolvedValue({ ...data, requests: [{ id: 3, topic: "My window topic", status: "done", lecture_slug: "sliding-window" }] });
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Your requests" }));
  expect(await screen.findByText("Recorded")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View lecture" }));
  expect(screen.getByRole("button", { name: /Sliding window.*Longest Substring/ }).getAttribute("aria-pressed")).toBe("true");
});

it("guards duplicate request submits and preserves a newly submitted status on refresh failure", async () => {
  let resolveRequest!: (value: { id: number; topic: string; status: "pending"; lecture_slug: null }) => void;
  vi.mocked(requestLecture).mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
  vi.mocked(fetchLectures).mockResolvedValueOnce(data).mockRejectedValueOnce(new Error("Refresh unavailable"));
  render(<LectureLibrary categoryLabels={labels} onTryProblem={vi.fn()} />);
  await screen.findByRole("button", { name: /Two pointers.*Valid Palindrome/ });
  fireEvent.click(screen.getByRole("button", { name: "Request a lecture" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Topic" }), { target: { value: "Segment trees" } });
  const form = screen.getByRole("form", { name: "Request a lecture" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(requestLecture).toHaveBeenCalledTimes(1);
  resolveRequest({ id: 8, topic: "Segment trees", status: "pending", lecture_slug: null });
  expect(await screen.findByText("Lecture availability and requests couldn't refresh")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Your requests.*pending/ }));
  expect(await screen.findByText("Segment trees")).toBeTruthy();
});
