import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLecture, fetchSolutionWalkthrough, recordLectureAudio, recordWalkthroughAudio } from "../lib/api";
import type { KojoLecture as Lecture, SolutionWalkthrough } from "../lib/types";
import { KojoLecture, KojoWalkthrough } from "./KojoWalkthrough";
import { buildTimeline } from "../lib/walkthroughTimeline";

vi.mock("../lib/api", () => ({
  fetchLecture: vi.fn(), fetchSolutionWalkthrough: vi.fn(),
  recordLectureAudio: vi.fn(() => new Promise(() => {})),
  recordWalkthroughAudio: vi.fn(() => new Promise(() => {})),
}));

const walk: SolutionWalkthrough = {
  title: "Greedy", breakdown: ["A short explanation."], key_points: [], approaches: [], frames: [],
  code: [{ line: "class Solution:", say: "Our solution." }],
  time_complexity: "O(n)", space_complexity: "O(1)", complexity_say: "Two passes.",
};

function openWalk(content = walk) {
  vi.mocked(fetchSolutionWalkthrough).mockResolvedValue({ slug: "partition-labels", solution_code: "", walkthrough: content });
  return render(<KojoWalkthrough slug="partition-labels" problemTitle="Partition Labels" statement="A problem" statementText="A problem" starterCode="" onClose={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  });
  localStorage.setItem("nosey_walkthrough_voice", "af_heart");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("long video narration", () => {
  it("reads consecutive browser chunks and shows only the current caption", async () => {
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    const longWalk = { ...walk, breakdown: ["A safe cut keeps every occurrence together. ".repeat(120)] };
    openWalk(longWalk);
    await screen.findByText("Browser voice (over 5 min)");
    const start = buildTimeline(longWalk, "Partition Labels").segments[1].start;
    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: String(start) } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(speak).toHaveBeenCalledOnce());
    const first = speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(first.text.length).toBeLessThanOrEqual(180);
    act(() => { first.onstart?.(new Event("start") as SpeechSynthesisEvent); first.onend?.(new Event("end") as SpeechSynthesisEvent); });
    expect(speak).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".walk-caption")?.textContent?.length).toBeLessThanOrEqual(180);
    expect(recordWalkthroughAudio).not.toHaveBeenCalled();
  });
  it("skips AI recording despite a saved AI voice and cannot unlock it by speeding up", async () => {
    openWalk({ ...walk, breakdown: ["word ".repeat(850)] });
    await screen.findByText("Browser voice (over 5 min)");
    expect(screen.queryByRole("button", { name: /^Kojo's voice:/ })).toBeNull();
    expect(recordWalkthroughAudio).not.toHaveBeenCalled();
    // Playback rate is independent of the original duration policy.
    fireEvent.click(screen.getByRole("button", { name: "Playback speed: 1x" }));
    fireEvent.click(screen.getByRole("option", { name: "2x" }));
    expect(recordWalkthroughAudio).not.toHaveBeenCalled();
    expect(localStorage.getItem("nosey_walkthrough_voice")).toBe("af_heart");
  });

  it("also skips AI recording for long pattern lectures", async () => {
    const lecture: Lecture = {
      title: "Greedy", summary: "Cut safely.", theory: [{ point: "Safety", say: "word ".repeat(850) }],
      theory_frames: [], signals: [], template: [], problem_intro: [], frames: [], code: [],
      time_complexity: "O(n)", space_complexity: "O(1)", complexity_say: "Linear.",
    };
    vi.mocked(fetchLecture).mockResolvedValue({
      slug: "greedy", title: "Greedy", category: "Greedy", summary: "Cut safely.",
      problem_slug: "partition-labels", problem_title: "Partition Labels", source: "curated", lecture,
    });
    render(<KojoLecture slug="greedy" onClose={() => {}} />);
    await screen.findByText("Browser voice (over 5 min)");
    expect(recordLectureAudio).not.toHaveBeenCalled();
  });

  it("preserves AI narration for short videos", async () => {
    openWalk();
    await waitFor(() => expect(recordWalkthroughAudio).toHaveBeenCalledOnce());
    expect(vi.mocked(recordWalkthroughAudio).mock.calls[0][1]).toBe("af_heart");
    expect(screen.queryByText("Browser voice (over 5 min)")).toBeNull();
  });

  it("keeps a short video on browser narration when that was the saved choice", async () => {
    localStorage.setItem("nosey_walkthrough_voice", "browser");
    openWalk();
    await screen.findByRole("button", { name: "Play video" });
    expect(recordWalkthroughAudio).not.toHaveBeenCalled();
  });
});
