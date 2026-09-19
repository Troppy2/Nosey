import { beforeAll, describe, expect, it } from "vitest";

import { runPythonMultiFile } from "../../../lib/pyodideRunner";
import { resolveMockPackages } from "../index";
import { normalizeSource } from "../raw";
import { consistentHashing } from "./meta";

import visualizerReference from "./visualizer/_reference.py?raw";
import projectReference from "./project/_reference.py?raw";

/**
 * Content is not reviewable without a reference solution that actually passes,
 * so this runs both exercises under a real Python runtime: the starters must be
 * red and the references green. Opt-in: `npm run test:pyodide`.
 */
const ENABLED = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.SD_PYODIDE_TESTS,
);

function filesFor(kind: "visualizer" | "project"): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of consistentHashing[kind].files) files[file.name] = file.contents;
  return files;
}

function run(kind: "visualizer" | "project", overrides: Record<string, string> = {}) {
  return runPythonMultiFile({
    files: { ...filesFor(kind), ...overrides },
    testModule: consistentHashing[kind].testModule,
    mockPackages: resolveMockPackages(consistentHashing[kind].mockPackages),
  });
}

describe.skipIf(!ENABLED)("consistent hashing content (integration)", () => {
  beforeAll(async () => {
    const packageName = "pyodide";
    const pyodideModule = await import(/* @vite-ignore */ packageName);
    const pyodide = await pyodideModule.loadPyodide();
    (window as unknown as { __noseyPyodide?: Promise<unknown> }).__noseyPyodide =
      Promise.resolve(pyodide);
  }, 120_000);

  it("fails the visualizer starter", async () => {
    expect((await run("visualizer")).ok).toBe(false);
  });

  it("passes the visualizer reference solution", async () => {
    const result = await run("visualizer", {
      "hashring.py": normalizeSource(visualizerReference),
    });
    expect(result.error).toBeUndefined();
    expect(result.cases.filter((testCase) => !testCase.passed)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("emits add_node, route and remove_node from the visualizer reference", async () => {
    const result = await run("visualizer", {
      "hashring.py": normalizeSource(visualizerReference),
    });
    const kinds = new Set(result.events.map((event) => event.kind));
    expect(kinds.has("add_node")).toBe(true);
    expect(kinds.has("route")).toBe(true);
    expect(kinds.has("remove_node")).toBe(true);
  });

  it("fails the project starter", async () => {
    expect((await run("project")).ok).toBe(false);
  });

  it("passes the project reference solution", async () => {
    const result = await run("project", {
      "sharded_store.py": normalizeSource(projectReference),
    });
    expect(result.error).toBeUndefined();
    expect(result.cases.filter((testCase) => !testCase.passed)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("emits move_key and a shards snapshot from the project reference", async () => {
    const result = await run("project", {
      "sharded_store.py": normalizeSource(projectReference),
    });
    const kinds = new Set(result.events.map((event) => event.kind));
    expect(kinds.has("move_key")).toBe(true);
    expect(
      result.events.some(
        (event) => event.kind === "snapshot" && event.payload.label === "shards",
      ),
    ).toBe(true);
  });
});
