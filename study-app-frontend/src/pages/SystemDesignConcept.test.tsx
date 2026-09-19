import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { caching } from "../data/systemDesign/caching/meta";
import SystemDesignConcept from "./SystemDesignConcept";

const settings = { betaMode: true };
const speech = { usable: true as boolean, reason: undefined as string | undefined };

vi.mock("../lib/useSettings", () => ({
  useSettings: () => settings,
  SETTINGS_KEYS: {},
}));

vi.mock("../components/episodeSpeech", async () => {
  const actual = await vi.importActual<typeof import("../components/episodeSpeech")>(
    "../components/episodeSpeech",
  );
  return { ...actual, speechCapability: () => speech };
});

vi.mock("../lib/api", () => ({
  getSystemDesignProgress: vi.fn(),
  markSystemDesignSubModule: vi.fn(),
  gradeSystemDesignQuiz: vi.fn(),
}));

const { getSystemDesignProgress, markSystemDesignSubModule, gradeSystemDesignQuiz } = await import(
  "../lib/api",
);
const mockedProgress = vi.mocked(getSystemDesignProgress);
const mockedMark = vi.mocked(markSystemDesignSubModule);
const mockedGrade = vi.mocked(gradeSystemDesignQuiz);

const NOTHING_DONE = {
  notesDone: false,
  videoDone: false,
  visualizerDone: false,
  projectDone: false,
  quizDone: false,
  quizBestScore: null,
  completedAt: null,
};

function renderConcept(conceptId = caching.id) {
  return render(
    <MemoryRouter initialEntries={[`/system-design/${conceptId}`]}>
      <Routes>
        <Route path="/system-design" element={<div>Track list</div>} />
        <Route path="/system-design/:conceptId" element={<SystemDesignConcept />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  settings.betaMode = true;
  speech.usable = true;
  mockedProgress.mockReset();
  mockedMark.mockReset();
  mockedGrade.mockReset();
  mockedProgress.mockResolvedValue({ concepts: {} });
  mockedMark.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("SystemDesignConcept page", () => {
  it("redirects to the track for an unknown conceptId", async () => {
    renderConcept("not-a-concept");
    expect(await screen.findByText("Track list")).toBeTruthy();
  });

  it("renders the notes markdown", async () => {
    renderConcept();
    expect(await screen.findByText(/A cache is a small, fast store/)).toBeTruthy();
  });

  it("marks notes read only when the button is pressed", async () => {
    renderConcept();
    const button = await screen.findByRole("button", { name: /mark as read/i });
    expect(mockedMark).not.toHaveBeenCalled();

    fireEvent.scroll(window, {});
    expect(mockedMark).not.toHaveBeenCalled();

    fireEvent.click(button);
    await waitFor(() => expect(mockedMark).toHaveBeenCalledWith(caching.id, "notes", true));
  });

  it("marks the video watched from its checkbox", async () => {
    renderConcept();
    const checkbox = await screen.findByLabelText(/i watched this/i);
    fireEvent.click(checkbox);
    await waitFor(() => expect(mockedMark).toHaveBeenCalledWith(caching.id, "video", true));
  });

  it("keeps the video checkbox usable when no video is set", async () => {
    expect(caching.video).toBeNull();
    renderConcept();
    expect(await screen.findByText(/no video is bundled with this concept yet/i)).toBeTruthy();
    fireEvent.click(await screen.findByLabelText(/i watched this/i));
    await waitFor(() => expect(mockedMark).toHaveBeenCalledWith(caching.id, "video", true));
  });

  it("hides the read-aloud control when speech is unsupported", async () => {
    speech.usable = false;
    renderConcept();
    await screen.findByRole("button", { name: /mark as read/i });
    expect(screen.queryByRole("button", { name: /read aloud/i })).toBeNull();
  });

  it("shows the completion banner only when all five sub-modules are done", async () => {
    renderConcept();
    await screen.findByRole("button", { name: /mark as read/i });
    expect(screen.queryByTestId("sd-concept-complete")).toBeNull();

    cleanup();
    mockedProgress.mockResolvedValue({
      concepts: {
        [caching.id]: {
          ...NOTHING_DONE,
          notesDone: true,
          videoDone: true,
          visualizerDone: true,
          projectDone: true,
          quizDone: true,
          completedAt: "2026-09-18T00:00:00Z",
        },
      },
    });
    renderConcept();
    expect(await screen.findByTestId("sd-concept-complete")).toBeTruthy();
  });

  it("links to both exercise workspaces", async () => {
    renderConcept();
    const visualizer = await screen.findByTestId("sd-open-visualizer");
    const project = await screen.findByTestId("sd-open-project");
    expect(visualizer.getAttribute("href")).toBe(`/system-design/${caching.id}/visualizer`);
    expect(project.getAttribute("href")).toBe(`/system-design/${caching.id}/project`);
  });
});

// ── quiz flow ─────────────────────────────────────────────────────────────────

const GOOD_ANSWER =
  "Cache aside has the application populate the cache after a miss, read through hides that in the client.";

const PASSING_RESULT = {
  mcqScore: 100,
  frqScore: 80,
  totalScore: 88,
  passed: true,
  graderDegraded: false,
  conceptCompleted: false,
  frqFeedback: caching.quiz.frq.map((question, index) => ({
    id: question.id,
    isCorrect: index < 4,
    feedback: `Feedback for ${question.id}`,
    confidence: 0.9,
    flaggedUncertain: false,
  })),
};

async function openQuiz() {
  renderConcept();
  fireEvent.click(await screen.findByTestId("sd-start-quiz"));
  return screen.findByTestId("sd-quiz");
}

function answerEverything(correctly = true) {
  for (const question of caching.quiz.mcq) {
    const index = correctly ? question.correctIndex : (question.correctIndex + 1) % 4;
    fireEvent.click(screen.getByTestId(`sd-mcq-${question.id}-${index}`));
  }
  for (const question of caching.quiz.frq) {
    fireEvent.change(screen.getByTestId(`sd-frq-${question.id}`), {
      target: { value: GOOD_ANSWER },
    });
  }
}

describe("SystemDesignConcept quiz", () => {
  it("grades the three mcq client-side against correctIndex", async () => {
    mockedGrade.mockResolvedValue(PASSING_RESULT);
    await openQuiz();
    answerEverything(false);
    fireEvent.click(screen.getByTestId("sd-quiz-submit"));

    await waitFor(() => expect(mockedGrade).toHaveBeenCalled());
    const payload = mockedGrade.mock.calls[0][1];
    expect(payload.mcq.every((item) => item.chosenIndex !== item.correctIndex)).toBe(true);
  });

  it("blocks submission with a visible message when an frq answer is too short", async () => {
    await openQuiz();
    for (const question of caching.quiz.mcq) {
      fireEvent.click(screen.getByTestId(`sd-mcq-${question.id}-${question.correctIndex}`));
    }
    fireEvent.change(screen.getByTestId(`sd-frq-${caching.quiz.frq[0].id}`), {
      target: { value: "too short" },
    });
    fireEvent.click(screen.getByTestId("sd-quiz-submit"));

    expect(await screen.findByTestId("sd-quiz-validation")).toBeTruthy();
    expect(mockedGrade).not.toHaveBeenCalled();
  });

  it("sends the notes, the mcq results and all five frq with their rubrics", async () => {
    mockedGrade.mockResolvedValue(PASSING_RESULT);
    await openQuiz();
    answerEverything();
    fireEvent.click(screen.getByTestId("sd-quiz-submit"));

    await waitFor(() => expect(mockedGrade).toHaveBeenCalled());
    const [conceptId, payload] = mockedGrade.mock.calls[0];
    expect(conceptId).toBe(caching.id);
    expect(payload.notes).toBe(caching.notes);
    expect(payload.mcq).toHaveLength(3);
    expect(payload.frq).toHaveLength(5);
    expect(payload.frq.map((item) => item.rubric)).toEqual(
      caching.quiz.frq.map((question) => question.rubric),
    );
    expect(payload.frq.every((item) => item.answer === GOOD_ANSWER)).toBe(true);
  });

  it("shows a blocking progress state while grading, with submit disabled", async () => {
    let resolveGrade: (value: typeof PASSING_RESULT) => void = () => {};
    mockedGrade.mockReturnValue(new Promise((resolve) => { resolveGrade = resolve; }));
    await openQuiz();
    answerEverything();
    fireEvent.click(screen.getByTestId("sd-quiz-submit"));

    expect(await screen.findByTestId("sd-quiz-grading")).toBeTruthy();
    expect((screen.getByTestId("sd-quiz-submit") as HTMLButtonElement).disabled).toBe(true);
    resolveGrade(PASSING_RESULT);
    await screen.findByTestId("sd-quiz-result");
  });

  it("shows the mcq score, per-frq feedback and the total on the result screen", async () => {
    mockedGrade.mockResolvedValue(PASSING_RESULT);
    await openQuiz();
    answerEverything();
    fireEvent.click(screen.getByTestId("sd-quiz-submit"));

    const result = await screen.findByTestId("sd-quiz-result");
    expect(result.textContent).toContain("100");
    expect(result.textContent).toContain("88");
    for (const question of caching.quiz.frq) {
      expect(screen.getByText(`Feedback for ${question.id}`)).toBeTruthy();
    }
  });

  it("shows a retry prompt rather than a hard fail when the grader is degraded", async () => {
    mockedGrade.mockResolvedValue({
      ...PASSING_RESULT,
      passed: false,
      graderDegraded: true,
      frqScore: 0,
      totalScore: 40,
    });
    await openQuiz();
    answerEverything();
    fireEvent.click(screen.getByTestId("sd-quiz-submit"));

    expect(await screen.findByTestId("sd-quiz-degraded")).toBeTruthy();
    expect(screen.queryByTestId("sd-quiz-failed")).toBeNull();
  });

  it("shows retry copy and does not mark the quiz done when grading returns 503", async () => {
    mockedGrade.mockRejectedValue(new Error("Grading is temporarily unavailable, try again shortly."));
    await openQuiz();
    answerEverything();
    fireEvent.click(screen.getByTestId("sd-quiz-submit"));

    expect(await screen.findByTestId("sd-quiz-error")).toBeTruthy();
    expect(screen.queryByTestId("sd-quiz-result")).toBeNull();
    expect(screen.getByTestId("sd-chip-quiz").dataset.done).toBe("false");
  });

  it("refreshes progress on a pass and celebrates a completed concept", async () => {
    mockedGrade.mockResolvedValue({ ...PASSING_RESULT, conceptCompleted: true });
    await openQuiz();
    mockedProgress.mockResolvedValue({
      concepts: {
        [caching.id]: {
          ...NOTHING_DONE,
          notesDone: true,
          videoDone: true,
          visualizerDone: true,
          projectDone: true,
          quizDone: true,
          quizBestScore: 88,
          completedAt: "2026-09-18T00:00:00Z",
        },
      },
    });
    answerEverything();
    fireEvent.click(screen.getByTestId("sd-quiz-submit"));

    expect(await screen.findByTestId("sd-quiz-celebration")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("sd-chip-quiz").dataset.done).toBe("true"));
  });
});

// ── layout and affordances ────────────────────────────────────────────────────

describe("SystemDesignConcept layout", () => {
  it("styles every primary button with the shared .button base class", async () => {
    renderConcept();
    await screen.findByRole("button", { name: /mark as read/i });
    // .button-primary only carries colour. Without .button a control renders
    // with no padding, radius or height at all.
    expect(document.querySelectorAll(".button-primary:not(.button)")).toHaveLength(0);
    expect(document.querySelectorAll(".button-secondary:not(.button)")).toHaveLength(0);
  });

  it("uses the app's back control rather than a stray text link", async () => {
    renderConcept();
    const back = await screen.findByLabelText(/back to all concepts/i);
    expect(back.getAttribute("href")).toBe("/system-design");
    expect(back.classList.contains("flash-back-btn")).toBe(true);
  });

  it("makes the sub-module chips jump links to their panels", async () => {
    renderConcept();
    const chip = await screen.findByTestId("sd-chip-project");
    expect(chip.getAttribute("href")).toBe("#sd-panel-project");
    expect(document.getElementById("sd-panel-project")).toBeTruthy();
  });

  it("shows the concept title once, not twice", async () => {
    renderConcept();
    await screen.findByRole("button", { name: /mark as read/i });
    const headings = screen
      .getAllByRole("heading")
      .filter((node) => node.textContent?.trim() === caching.title);
    expect(headings).toHaveLength(1);
  });

  it("hides the read-aloud transport until something is playing", async () => {
    renderConcept();
    await screen.findByRole("button", { name: /read aloud/i });
    expect(screen.queryByRole("button", { name: /^forward$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull();
  });

  it("swaps Mark as read for a done flag and an undo", async () => {
    mockedProgress.mockResolvedValue({
      concepts: { [caching.id]: { ...NOTHING_DONE, notesDone: true } },
    });
    renderConcept();
    expect(await screen.findByText(/marked as read/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(mockedMark).toHaveBeenCalledWith(caching.id, "notes", false));
  });
});

describe("panel call to action spacing", () => {
  // The shared .button lifts itself 2px on hover and `p { margin: 0 }` is
  // global, so a CTA placed straight after a paragraph rides up over the copy
  // unless it carries the class that adds the gap. jsdom has no CSS, so the
  // class is the contract this test can hold onto.
  it("gives every panel CTA the sd-panel-cta spacing class", async () => {
    renderConcept();
    const start = await screen.findByTestId("sd-start-quiz");
    expect(start.classList.contains("sd-panel-cta")).toBe(true);
    expect(screen.getByTestId("sd-open-visualizer").classList.contains("sd-panel-cta")).toBe(true);
    expect(screen.getByTestId("sd-open-project").classList.contains("sd-panel-cta")).toBe(true);
  });

  it("leaves no .button in the page without a spacing owner", async () => {
    renderConcept();
    await screen.findByTestId("sd-start-quiz");
    // Every .button here is either inside a spacing container (.button-row,
    // .sd-panel-foot) or carries .sd-panel-cta itself.
    const unspaced = [...document.querySelectorAll(".button")].filter(
      (el) =>
        !el.classList.contains("sd-panel-cta") &&
        !el.closest(".button-row") &&
        !el.closest(".sd-panel-foot"),
    );
    expect(unspaced.map((el) => el.textContent?.trim())).toEqual([]);
  });
});
