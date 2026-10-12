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
import LearningModuleLesson, { easeChunkProgress, mapScriptToBlocks, splitLessonBlocks } from "./LearningModuleLesson";

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

  it("shows exactly one spinner while saving and rebuilding an edited article", async () => {
    // The LoadingNotice owns the spinner and the explanation. The Save button
    // used to render its own InlineLoading as well, and since the button is
    // disabled while saving, its faded style left that ring looking like it was
    // floating unattached next to Cancel.
    vi.mocked(updateModuleLesson).mockReturnValue(new Promise(() => {}) as never);

    const { container } = renderPage();
    fireEvent.click(await waitFor(() => screen.getByLabelText("Lesson options")));
    fireEvent.click(screen.getByText("Edit article"));
    fireEvent.click(await waitFor(() => screen.getByText("Save and rebuild audio + quiz")));

    await waitFor(() => expect(screen.getByText(/Rebuilding the audio script/i)).toBeTruthy());
    expect(container.querySelectorAll(".loader")).toHaveLength(1);
    expect(screen.getByText("Rebuilding…")).toBeTruthy();
    expect(vi.mocked(updateModuleLesson).mock.lastCall?.[2]).toBe(true);
  });

  it("Save article saves the text only, with no rebuild", async () => {
    vi.mocked(updateModuleLesson).mockReturnValue(new Promise(() => {}) as never);
    renderPage();
    fireEvent.click(await waitFor(() => screen.getByLabelText("Lesson options")));
    fireEvent.click(screen.getByText("Edit article"));
    fireEvent.click(await waitFor(() => screen.getByText("Save article")));

    await waitFor(() => expect(screen.getByText("Saving…")).toBeTruthy());
    expect(screen.queryByText(/Rebuilding the audio script/i)).toBeNull();
    expect(vi.mocked(updateModuleLesson).mock.lastCall?.[2]).toBe(false);
  });

  it("Reformat on a clean article saves nothing and says so", async () => {
    vi.mocked(updateModuleLesson).mockClear();
    renderPage();
    fireEvent.click(await waitFor(() => screen.getByLabelText("Reformat article")));
    await waitFor(() => expect(screen.getByText(/Nothing to fix/i)).toBeTruthy());
    expect(updateModuleLesson).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Edit article")).toBeNull();
  });

  it("Reformat repairs a broken article in place without opening the editor", async () => {
    const mangled = { ...TRACK.modules[0], lesson_content: "## Intro" + BS + "n" + BS + "nText." };
    vi.mocked(fetchTrackForModule).mockResolvedValue({ ...TRACK, modules: [mangled] } as never);
    vi.mocked(updateModuleLesson).mockClear();
    vi.mocked(updateModuleLesson).mockResolvedValue({ ...mangled, lesson_content: "## Intro\n\nText." } as never);

    renderPage();
    fireEvent.click(await waitFor(() => screen.getByLabelText("Reformat article")));

    await waitFor(() => expect(screen.getByText("Article reformatted.")).toBeTruthy());
    expect(vi.mocked(updateModuleLesson).mock.lastCall).toEqual([42, "## Intro\n\nText.", false]);
    expect(screen.queryByText("Edit article", { selector: "label" })).toBeNull();
  });

  it("lets the seek thumb glide while dragging instead of snapping to a chunk", async () => {
    renderPage();
    const seek = (await waitFor(() => screen.getByLabelText("Seek position in the narration"))) as HTMLInputElement;
    fireEvent.change(seek, { target: { value: "0.4" } });
    expect(Number(seek.value)).toBeCloseTo(0.4);
    // Released anywhere, not only over the slider: a release outside it used
    // to leave the drag stuck and the bar frozen.
    fireEvent.pointerUp(window);
    await waitFor(() => expect(Number(seek.value)).toBe(0));
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

// Same cases as study-app-backend/tests/test_lesson_blocks.py. The backend
// counts blocks to tell the model how many script entries to write, so both
// splitters must cut in the same places. Change both tests together.
describe("block split parity with the backend", () => {
  const cases: [string, string[]][] = [
    ["## Intro\n\nFirst para.\nStill first.\n\nSecond.", ["## Intro", "First para.\nStill first.", "Second."]],
    ["Text.\n\n```py\nx = 1\n\ny = 2\n```\n\nAfter.", ["Text.", "```py\nx = 1\n\ny = 2\n```", "After."]],
    ["Before.\n\n$$\na = b\n\nc = d\n$$\n\nAfter.", ["Before.", "$$\na = b\n\nc = d\n$$", "After."]],
    ["Open.\n\n$$\nx = 1\n## Next\n\nBody.", ["Open.", "$$\nx = 1", "## Next", "Body."]],
    ["\n\n- a\n- b\n\n\n\nEnd.\n", ["- a\n- b", "End."]],
  ];
  it.each(cases)("splits %j", (markdown, expected) => {
    expect(splitLessonBlocks(markdown)).toEqual(expected);
  });
});

describe("mapScriptToBlocks", () => {
  const lesson = "## Arrays\n\nArrays store items in order.\n\n```py\nxs = [1]\n```\n\nIndexing is constant time.";
  const blocks = splitLessonBlocks(lesson);

  it("maps a JSON-array script entry by entry and skips empty entries", () => {
    const script = JSON.stringify(["Let's talk arrays.", "An array keeps items in order.", "", "Reading one slot is fast."]);
    expect(mapScriptToBlocks(script, lesson, blocks).map((p) => p.blockIndex)).toEqual([0, 1, 3]);
  });

  it("maps through raw blocks when the displayed lesson splits differently", () => {
    // The page shows a repaired lesson with an extra block in front.
    const display = ["Note.", ...blocks];
    const script = JSON.stringify(["Arrays.", "Items in order.", "Code.", "Constant time."]);
    expect(mapScriptToBlocks(script, lesson, display).map((p) => p.blockIndex)).toEqual([1, 2, 3, 4]);
  });

  it("splits a legacy script on single newlines when it has no blank lines", () => {
    const script = "Arrays.\nArrays store items in order.\nThe code makes a list.\nIndexing is constant time.";
    expect(mapScriptToBlocks(script, lesson, blocks).map((p) => p.blockIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe("easeChunkProgress", () => {
  it("is linear early, then slows and never reaches the end of the chunk", () => {
    expect(easeChunkProgress(0.5)).toBe(0.5);
    const samples = [0.8, 0.9, 1, 1.5, 3].map(easeChunkProgress);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
      expect(samples[i]).toBeLessThanOrEqual(0.99);
    }
    // Same speed on both sides of 0.8, so no kink.
    expect(easeChunkProgress(0.801) - easeChunkProgress(0.8)).toBeCloseTo(0.001, 4);
  });
});
