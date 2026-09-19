import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { caching } from "../data/systemDesign/caching/meta";
import SystemDesignWorkspace from "./SystemDesignWorkspace";
import type { MultiFileTestResult } from "../lib/pyodideRunner";

const settings = { betaMode: true };

vi.mock("../lib/useSettings", () => ({
  useSettings: () => settings,
  SETTINGS_KEYS: {},
}));

// A plain textarea stands in for Monaco: the workspace's own behaviour (tabs,
// autosave, run, done) is what is under test, not the editor widget.
vi.mock("@monaco-editor/react", () => ({
  default: ({
    path,
    defaultValue,
    onChange,
    options,
  }: {
    path?: string;
    defaultValue?: string;
    onChange?: (value: string | undefined) => void;
    options?: { readOnly?: boolean };
  }) => (
    <textarea
      data-testid="sd-editor"
      data-path={path}
      data-readonly={options?.readOnly ? "true" : "false"}
      readOnly={Boolean(options?.readOnly)}
      defaultValue={defaultValue}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock("../components/KojoHelpChat", () => ({
  KojoHelpChat: () => <div data-testid="sd-kojo-chat" />,
}));

vi.mock("../lib/api", () => ({
  getSystemDesignSubmission: vi.fn(),
  putSystemDesignSubmission: vi.fn(),
}));

vi.mock("../lib/pyodideRunner", () => ({
  runPythonMultiFile: vi.fn(),
}));

const { getSystemDesignSubmission, putSystemDesignSubmission } = await import("../lib/api");
const { runPythonMultiFile } = await import("../lib/pyodideRunner");
const mockedGet = vi.mocked(getSystemDesignSubmission);
const mockedPut = vi.mocked(putSystemDesignSubmission);
const mockedRun = vi.mocked(runPythonMultiFile);

const PASSING: MultiFileTestResult = {
  ok: true,
  cases: [{ name: "returns a value that was put", passed: true }],
  stdout: "all good\n",
  events: [{ t: 1, kind: "cache_hit", payload: { key: "a" } }],
};

const FAILING: MultiFileTestResult = {
  ok: false,
  cases: [
    { name: "returns a value that was put", passed: false, message: "expected 1, got None" },
  ],
  stdout: "",
  events: [],
};

function renderWorkspace(kind = "visualizer") {
  return render(
    <MemoryRouter initialEntries={[`/system-design/${caching.id}/${kind}`]}>
      <Routes>
        <Route path="/system-design/:conceptId" element={<div>Concept page</div>} />
        <Route path="/system-design/:conceptId/:exerciseKind" element={<SystemDesignWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  settings.betaMode = true;
  mockedGet.mockReset();
  mockedPut.mockReset();
  mockedRun.mockReset();
  mockedGet.mockResolvedValue({ files: {}, lastRunPassed: false, passedAt: null });
  mockedPut.mockResolvedValue(undefined);
  mockedRun.mockResolvedValue(PASSING);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SystemDesignWorkspace", () => {
  it("redirects for an invalid exerciseKind", async () => {
    renderWorkspace("quiz");
    expect(await screen.findByText("Concept page")).toBeTruthy();
  });

  it("renders one tab per exercise file", async () => {
    renderWorkspace("project");
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    const tabs = screen.getAllByTestId("sd-file-tab");
    expect(tabs.map((tab) => tab.dataset.file)).toEqual(
      caching.project.files.map((file) => file.name),
    );
  });

  it("renders a readonly file with a lock and a read-only editor", async () => {
    renderWorkspace("project");
    const storeTab = await screen.findByRole("tab", { name: /store\.py/i });
    expect(storeTab.dataset.readonly).toBe("true");
    fireEvent.click(storeTab);
    expect(screen.getByTestId("sd-editor").dataset.readonly).toBe("true");
  });

  it("hydrates from the server submission when one exists", async () => {
    mockedGet.mockResolvedValue({
      files: { "cache.py": "# my work in progress\n" },
      lastRunPassed: false,
      passedAt: null,
    });
    renderWorkspace();
    await waitFor(() =>
      expect((screen.getByTestId("sd-editor") as HTMLTextAreaElement).value).toContain(
        "# my work in progress",
      ),
    );
  });

  it("falls back to the bundled starters when the server has no submission", async () => {
    renderWorkspace();
    await waitFor(() =>
      expect((screen.getByTestId("sd-editor") as HTMLTextAreaElement).value).toBe(
        caching.visualizer.files[0].contents,
      ),
    );
  });

  it("debounces autosave into a single call for a burst of edits", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    vi.useFakeTimers();

    const editor = screen.getByTestId("sd-editor");
    fireEvent.change(editor, { target: { value: "one" } });
    fireEvent.change(editor, { target: { value: "two" } });
    fireEvent.change(editor, { target: { value: "three" } });
    expect(mockedPut).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockedPut).toHaveBeenCalledTimes(1);
    expect(mockedPut.mock.calls[0][2]).toBe(false);
  });

  it("autosaves every file, not just the active tab", async () => {
    renderWorkspace("project");
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    vi.useFakeTimers();

    fireEvent.change(screen.getByTestId("sd-editor"), { target: { value: "edited client" } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    const files = mockedPut.mock.calls[0][1];
    expect(Object.keys(files).sort()).toEqual(
      caching.project.files.map((file) => file.name).sort(),
    );
  });

  it("renders the case list, stdout and the timeline panel after Run", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    const cases = await screen.findByTestId("sd-case-list");
    expect(within(cases).getByText(/returns a value that was put/)).toBeTruthy();
    expect(screen.getByTestId("sd-stdout").textContent).toContain("all good");
    expect(screen.getAllByTestId("sd-timeline-row").length).toBeGreaterThan(0);
  });

  it("never marks the exercise done from Run", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await screen.findByTestId("sd-case-list");
    expect(mockedPut.mock.calls.every((call) => call[2] === false)).toBe(true);
  });

  it("marks the exercise done when Done passes", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith(
        `${caching.id}:visualizer`,
        expect.any(Object),
        true,
      ),
    );
    expect(await screen.findByTestId("sd-done-banner")).toBeTruthy();
  });

  it("does not mark done on a failing run, and says which cases failed", async () => {
    mockedRun.mockResolvedValue(FAILING);
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    await screen.findByTestId("sd-case-list");
    expect(mockedPut.mock.calls.every((call) => call[2] === false)).toBe(true);
    expect(screen.queryByTestId("sd-done-banner")).toBeNull();
    expect(screen.getByText(/expected 1, got None/)).toBeTruthy();
  });

  it("renders a harness error distinctly from failing assertions", async () => {
    mockedRun.mockResolvedValue({
      ok: false,
      cases: [],
      stdout: "",
      events: [],
      error: "SyntaxError: invalid syntax",
    });
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    expect(await screen.findByTestId("sd-run-error")).toBeTruthy();
    expect(screen.queryByTestId("sd-case-list")).toBeNull();
  });

  it("keeps the editor buffer when autosave fails", async () => {
    mockedPut.mockRejectedValue(new Error("offline"));
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    vi.useFakeTimers();

    fireEvent.change(screen.getByTestId("sd-editor"), { target: { value: "still here" } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();

    expect((screen.getByTestId("sd-editor") as HTMLTextAreaElement).value).toBe("still here");
    expect(await screen.findByTestId("sd-autosave-warning")).toBeTruthy();
  });
});

// ── layout and affordances ────────────────────────────────────────────────────

describe("SystemDesignWorkspace layout", () => {
  it("keeps the results pane out of the way until there is a result", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    const body = document.querySelector(".sd-workspace-body") as HTMLElement;
    expect(body.dataset.hasResult).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await screen.findByTestId("sd-case-list");
    expect((document.querySelector(".sd-workspace-body") as HTMLElement).dataset.hasResult).toBe("true");
  });

  it("styles every action button with the shared .button base class", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(document.querySelectorAll(".button-primary:not(.button)")).toHaveLength(0);
    expect(document.querySelectorAll(".button-secondary:not(.button)")).toHaveLength(0);
  });

  it("makes Run the primary action until a run passes, then Done", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /^run$/i }).classList.contains("button-primary")).toBe(true);
    expect(screen.getByRole("button", { name: /done/i }).classList.contains("button-secondary")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await screen.findByTestId("sd-case-list");
    expect(screen.getByRole("button", { name: /done/i }).classList.contains("button-primary")).toBe(true);
  });

  it("leads with a summary and puts failing cases first", async () => {
    mockedRun.mockResolvedValue({
      ok: false,
      cases: [
        { name: "passes fine", passed: true },
        { name: "fails badly", passed: false, message: "expected 1, got None" },
      ],
      stdout: "",
      events: [],
    });
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    const list = await screen.findByTestId("sd-case-list");
    expect(document.querySelector(".sd-result-summary")?.textContent).toMatch(/1 of 2 cases failing/);
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0].dataset.passed).toBe("false");
  });

  it("hides the output block when the run printed nothing", async () => {
    mockedRun.mockResolvedValue({ ...PASSING, stdout: "" });
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    await screen.findByTestId("sd-case-list");
    expect(screen.queryByTestId("sd-stdout")).toBeNull();
  });

  it("offers a pane switch that lands on the results after a run", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    const resultsTab = screen.getByRole("tab", { name: /results/i });
    expect((resultsTab as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await screen.findByTestId("sd-case-list");
    expect((document.querySelector(".sd-workspace-body") as HTMLElement).dataset.pane).toBe("results");
    expect((screen.getByRole("tab", { name: /results/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses the app's back control to the concept page", async () => {
    renderWorkspace();
    const back = await screen.findByLabelText(/back to caching/i);
    expect(back.getAttribute("href")).toBe(`/system-design/${caching.id}`);
    expect(back.classList.contains("flash-back-btn")).toBe(true);
  });
});

describe("SystemDesignWorkspace results emphasis", () => {
  it("folds the case list away on a green run and opens it on a red one", async () => {
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await screen.findByTestId("sd-case-list");
    expect((document.querySelector(".sd-case-details") as HTMLDetailsElement).open).toBe(false);

    cleanup();
    mockedRun.mockResolvedValue(FAILING);
    renderWorkspace();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await screen.findByTestId("sd-case-list");
    expect((document.querySelector(".sd-case-details") as HTMLDetailsElement).open).toBe(true);
  });
});
