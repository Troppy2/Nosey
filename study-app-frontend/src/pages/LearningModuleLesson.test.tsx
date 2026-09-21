import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The page loads its track asynchronously, so the FIRST render always takes an
// early-return path ("still loading") and a later one renders the full page.
// That makes it the exact shape that punishes a hook declared below those early
// returns: React counts a different number of hooks between the two renders and
// throws "Rendered more hooks than during the previous render", blanking the
// page the moment the lesson arrives.
//
// This repo has no ESLint, so react-hooks/rules-of-hooks never runs, and
// neither tsc nor vite build looks at hook order. A regression here is
// invisible until someone opens the page, which is how it shipped once.
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    scopeKey: (key: string) => key,
    fetchTrackForModule: vi.fn(),
    submitModuleQuiz: vi.fn(),
    updateModuleLesson: vi.fn(),
    updateModuleVideo: vi.fn(),
  };
});

vi.mock("../lib/useSettings", () => ({ useSettings: () => ({ betaMode: true }) }));

import { fetchTrackForModule, updateModuleLesson } from "../lib/api";
import LearningModuleLesson, { splitLessonBlocks } from "./LearningModuleLesson";

const BS = "\\";

const TRACK = {
  id: 1,
  folder_id: 7,
  status: "ready",
  module_count: 1,
  format: "article",
  notes_stale: false,
  modules: [
    {
      id: 42,
      order_index: 0,
      title: "Binary Search Trees",
      summary: "Ordering invariants",
      lesson_content:
        "## How lookup works\n\nA binary search tree keeps every left subtree smaller.\n\nThat halving gives logarithmic behaviour.",
      tts_script: "",
      video_url: null,
      quiz: [{ question: "Q1?", options: ["A", "B", "C", "D"] }],
      best_score: null,
      passed: false,
      ready: true,
      episode_ready: false,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/flashcards/7/modules/42"]}>
      <Routes>
        <Route path="/flashcards/:folderId/modules/:moduleId" element={<LearningModuleLesson />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LearningModuleLesson", () => {
  beforeAll(() => {
    // This jsdom setup exposes no localStorage, which the page reads on mount
    // (saved audio position, voice, rate, quiz draft).
    if (!("localStorage" in window) || !window.localStorage) {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      });
    }
    // No speechSynthesis in jsdom, and ttsSupported gates the whole dock on it.
    if (!("speechSynthesis" in window)) {
      vi.stubGlobal("speechSynthesis", {
        getVoices: () => [],
        speak() {},
        cancel() {},
        addEventListener() {},
        removeEventListener() {},
      });
      vi.stubGlobal(
        "SpeechSynthesisUtterance",
        class {
          text: string;
          rate = 1;
          voice: unknown = null;
          constructor(text: string) {
            this.text = text;
          }
        },
      );
    }
    // jsdom ships neither of these; the page uses both unconditionally.
    if (!("IntersectionObserver" in window)) {
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
    }
    if (!window.matchMedia) {
      vi.stubGlobal("matchMedia", () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }));
    }
  });

  beforeEach(() => {
    vi.mocked(fetchTrackForModule).mockResolvedValue(TRACK as never);
    localStorage.clear();
  });

  afterEach(cleanup);

  it("survives the loading to loaded transition without a hook-order error", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args[0]));

    renderPage();

    // The article only appears on the post-load render, which is the render
    // that would have thrown.
    await waitFor(() => expect(screen.getByText(/Binary Search Trees/i)).toBeTruthy());

    const hookErrors = errors.filter((e) => String(e).includes("Rendered more hooks"));
    expect(hookErrors).toEqual([]);
    spy.mockRestore();
  });

  it("renders the audio dock once the lesson has loaded", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Listen to this lesson")).toBeTruthy());
  });

  it("shows the reformat button when the article's formatting is broken", async () => {
    vi.mocked(fetchTrackForModule).mockResolvedValue({
      ...TRACK,
      modules: [
        {
          ...TRACK.modules[0],
          // Literal backslash-n instead of newlines, as Ollama stored it.
          lesson_content: "Measures of Spread" + BS + "n" + BS + "nIn statistics." + BS + "n" + BS + "n## The Range" + BS + "n" + BS + "nThe simplest measure.",
        },
      ],
    } as never);
    renderPage();
    const button = await waitFor(() => screen.getByLabelText("Reformat article"));
    expect(button.className).toContain("is-needed");
  });

  it("shows the reformat button when only the maths lost its backslashes", async () => {
    vi.mocked(fetchTrackForModule).mockResolvedValue({
      ...TRACK,
      modules: [
        {
          ...TRACK.modules[0],
          // Paragraphs already fine, maths still broken: the state the article
          // is in after a first reformat, so the button must come back.
          lesson_content:
            "# Variance\n\nThe formula is:\n\n$$text{Var}(s^2) = frac{sum(x)}{n-1}$$\n",
        },
      ],
    } as never);
    renderPage();
    const button = await waitFor(() => screen.getByLabelText("Reformat article"));
    expect(button.className).toContain("is-needed");
  });

  it("still offers the reformat button on a clean article, just unemphasised", async () => {
    // Deliberately not gated on the detector: the repair is idempotent, and a
    // detector with one false negative would hide the fix exactly when needed.
    renderPage();
    const button = await waitFor(() => screen.getByLabelText("Reformat article"));
    expect(button.className).not.toContain("is-needed");
    expect(button.getAttribute("title")).toBe("Reformat article");
  });

  it("shows exactly one spinner while saving a reformatted article", async () => {
    // The LoadingNotice owns the spinner and the explanation. The Save button
    // used to render its own InlineLoading as well, and since the button is
    // disabled while saving, its faded style left that ring looking like it was
    // floating unattached next to Cancel.
    vi.mocked(updateModuleLesson).mockReturnValue(new Promise(() => {}) as never);

    const { container } = renderPage();
    const reformat = await waitFor(() => screen.getByLabelText("Reformat article"));
    fireEvent.click(reformat);

    const save = await waitFor(() => screen.getByText("Save article"));
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/Rebuilding the audio script/i)).toBeTruthy());
    expect(container.querySelectorAll(".loader")).toHaveLength(1);
    expect(screen.getByText("Saving…")).toBeTruthy();
  });

  it("starts with the dock shown, not hidden behind the quiz", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByLabelText("Listen to this lesson")).toBeTruthy());
    expect(container.querySelector(".lm-audio-player")?.getAttribute("data-hidden")).toBe("false");
  });
});

// Each block is rendered by its own MarkdownContent, so a block boundary is
// also a parser boundary. A $$...$$ block cut in half leaves one unbalanced
// delimiter in each fragment, and neither half renders as maths.
describe("splitLessonBlocks", () => {
  const B = "\\"; // one backslash, spelled out so the source stays readable

  it("splits ordinary prose on blank lines", () => {
    expect(splitLessonBlocks("One.\n\nTwo.\n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });

  it("keeps a fenced code block whole across its blank lines", () => {
    const blocks = splitLessonBlocks("Intro.\n\n```python\nx = 1\n\ny = 2\n```\n\nEnd.");
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toBe("```python\nx = 1\n\ny = 2\n```");
  });

  it("keeps a display-math block whole across its blank lines", () => {
    const article = [
      "Intro prose.",
      "",
      "$$",
      B + "begin{aligned}",
      "x &= 1 " + B + B,
      "",
      "y &= 2",
      B + "end{aligned}",
      "$$",
      "",
      "Closing prose.",
    ].join("\n");

    const blocks = splitLessonBlocks(article);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe("Intro prose.");
    expect(blocks[2]).toBe("Closing prose.");
    // Both delimiters must stay together in the one block.
    expect((blocks[1].match(/\$\$/g) ?? []).length).toBe(2);
    expect(blocks[1]).toContain(B + "begin{aligned}");
    expect(blocks[1]).toContain(B + "end{aligned}");
  });

  it("keeps a single-line display-math block on its own", () => {
    const article = "Before.\n\n$$" + B + "frac{a}{b}$$\n\nAfter.";
    expect(splitLessonBlocks(article)).toEqual(["Before.", "$$" + B + "frac{a}{b}$$", "After."]);
  });

  it("recovers at the next heading when a display delimiter is never closed", () => {
    // An unbalanced $$ must not swallow the remainder of the article into one
    // unsplittable block.
    const article = "Intro.\n\n$$\n\nStray.\n\n## A heading\n\nMore prose.";
    const blocks = splitLessonBlocks(article);
    expect(blocks).toContain("## A heading");
    expect(blocks).toContain("More prose.");
  });
});
