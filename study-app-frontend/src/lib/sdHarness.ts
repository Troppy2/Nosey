import simSource from "../data/systemDesign/_shared/sim.py?raw";
import { normalizeSource } from "../data/systemDesign/raw";

/**
 * Every decision the System Design test harness makes, factored out of the
 * Pyodide call so it can be unit tested without booting a Python runtime.
 * runPythonMultiFile is deliberately thin: if a rule lives inside the Pyodide
 * exec string it cannot be tested, so it does not live there.
 */

export const SD_WORK_DIR = "/sd";
/** The hidden test module. Authored, never shown, never editable. */
export const SD_TEST_MODULE_NAME = "_sd_tests.py";
/** The instrumentation module every exercise can import, whether it asks or not. */
export const SD_SIM_MODULE_NAME = "sim.py";
export const SD_SIM_SOURCE = normalizeSource(simSource);

export type SimEvent = { t: number; kind: string; payload: Record<string, unknown> };

export type TestCaseResult = { name: string; passed: boolean; message?: string };

export type ParsedTestResults = { cases: TestCaseResult[]; error?: string };

export type HarnessFile = { path: string; contents: string };

export type BuildHarnessArgs = {
  files: Record<string, string>;
  testModule: string;
  mockPackages?: Record<string, string>;
};

function assertValidModuleName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`Invalid module name: ${name}`);
  }
  if (!name.endsWith(".py")) {
    throw new Error(`Exercise files must be Python modules: ${name}`);
  }
}

/**
 * The exact virtual filesystem to write, in write order: mock packages first,
 * then the learner's files, then the hidden test module last. Order matters
 * because a later write wins, and the hidden tests must never be shadowed.
 */
export function buildHarnessFiles(args: BuildHarnessArgs): HarnessFile[] {
  const mockPackages: Record<string, string> = { ...(args.mockPackages ?? {}) };
  // sim is always available: the timeline panel is part of the mode, not an
  // opt-in of a particular exercise.
  if (!mockPackages[SD_SIM_MODULE_NAME]) {
    mockPackages[SD_SIM_MODULE_NAME] = SD_SIM_SOURCE;
  }

  const ordered: HarnessFile[] = [];
  for (const name of Object.keys(mockPackages).sort()) {
    assertValidModuleName(name);
    ordered.push({ path: `${SD_WORK_DIR}/${name}`, contents: mockPackages[name] });
  }

  for (const [name, contents] of Object.entries(args.files ?? {})) {
    assertValidModuleName(name);
    if (name === SD_TEST_MODULE_NAME) {
      throw new Error(`${SD_TEST_MODULE_NAME} is reserved for the hidden tests.`);
    }
    if (name in mockPackages) {
      throw new Error(`${name} is a provided module and cannot be replaced.`);
    }
    ordered.push({ path: `${SD_WORK_DIR}/${name}`, contents });
  }

  ordered.push({ path: `${SD_WORK_DIR}/${SD_TEST_MODULE_NAME}`, contents: args.testModule ?? "" });
  return ordered;
}

/**
 * Turn whatever run_tests() returned into cases. A shape we do not recognise is
 * an error rather than a silent pass: a test module that asserts nothing must
 * never read as a green run.
 */
export function parseTestResults(raw: unknown): ParsedTestResults {
  if (!Array.isArray(raw)) {
    return { cases: [], error: "The exercise tests did not return a list of results." };
  }
  if (raw.length === 0) {
    return { cases: [], error: "The exercise tests reported no cases." };
  }

  const cases: TestCaseResult[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) {
      return { cases: [], error: "The exercise tests returned a malformed result." };
    }
    const [name, passed, message] = entry as [unknown, unknown, unknown];
    cases.push({
      name: String(name ?? ""),
      passed: Boolean(passed),
      ...(message === undefined || message === null || message === ""
        ? {}
        : { message: String(message) }),
    });
  }
  return { cases };
}

/** Sorted by t, ties broken by the order the run emitted them. */
export function normalizeSimEvents(raw: unknown): SimEvent[] {
  if (!Array.isArray(raw)) return [];

  const kept: Array<{ event: SimEvent; index: number }> = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const candidate = entry as Record<string, unknown>;
    const t = candidate.t;
    const kind = candidate.kind;
    if (typeof t !== "number" || !Number.isFinite(t)) return;
    if (typeof kind !== "string" || kind === "") return;

    const rawPayload = candidate.payload;
    const payload =
      rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
        ? { ...(rawPayload as Record<string, unknown>) }
        : {};
    kept.push({ event: { t, kind, payload }, index });
  });

  return kept
    .sort((a, b) => (a.event.t === b.event.t ? a.index - b.index : a.event.t - b.event.t))
    .map((item) => item.event);
}

/** A run is green only when it actually ran cases and every one of them passed. */
export function computeOk(result: { cases: TestCaseResult[]; error?: string }): boolean {
  if (result.error) return false;
  if (!result.cases.length) return false;
  return result.cases.every((testCase) => testCase.passed);
}
