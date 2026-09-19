import { beforeAll, describe, expect, it } from "vitest";

import { runPythonMultiFile } from "../../../lib/pyodideRunner";
import { resolveMockPackages } from "../index";
import { normalizeSource } from "../raw";
import { caching } from "./meta";

import visualizerReference from "./visualizer/_reference.py?raw";
import projectReference from "./project/_reference.py?raw";

/**
 * Content is not reviewable without a reference solution that actually passes,
 * so this runs both exercises under a real Python runtime: the starters must be
 * red and the references green. Opt-in, like the runner's own integration test:
 * `npm run test:pyodide`.
 */
const ENABLED = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.SD_PYODIDE_TESTS,
);

function filesFor(kind: "visualizer" | "project"): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of caching[kind].files) files[file.name] = file.contents;
  return files;
}

function run(kind: "visualizer" | "project", overrides: Record<string, string> = {}) {
  return runPythonMultiFile({
    files: { ...filesFor(kind), ...overrides },
    testModule: caching[kind].testModule,
    mockPackages: resolveMockPackages(caching[kind].mockPackages),
  });
}

describe.skipIf(!ENABLED)("caching content (integration)", () => {
  beforeAll(async () => {
    const packageName = "pyodide";
    const pyodideModule = await import(/* @vite-ignore */ packageName);
    const pyodide = await pyodideModule.loadPyodide();
    (window as unknown as { __noseyPyodide?: Promise<unknown> }).__noseyPyodide =
      Promise.resolve(pyodide);
  }, 120_000);

  it("fails the visualizer starter", async () => {
    const result = await run("visualizer");
    expect(result.ok).toBe(false);
  });

  it("passes the visualizer reference solution", async () => {
    const result = await run("visualizer", { "cache.py": normalizeSource(visualizerReference) });
    expect(result.error).toBeUndefined();
    expect(result.cases.filter((testCase) => !testCase.passed)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("emits cache_hit, cache_miss and evict from the visualizer reference", async () => {
    const result = await run("visualizer", { "cache.py": normalizeSource(visualizerReference) });
    const kinds = new Set(result.events.map((event) => event.kind));
    expect(kinds.has("cache_hit")).toBe(true);
    expect(kinds.has("cache_miss")).toBe(true);
    expect(kinds.has("evict")).toBe(true);
  });

  it("fails the project starter", async () => {
    const result = await run("project");
    expect(result.ok).toBe(false);
  });

  it("passes the project reference solution", async () => {
    const result = await run("project", { "cache_client.py": normalizeSource(projectReference) });
    expect(result.error).toBeUndefined();
    expect(result.cases.filter((testCase) => !testCase.passed)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("emits store_read and cache_expired from the project reference", async () => {
    const result = await run("project", { "cache_client.py": normalizeSource(projectReference) });
    const kinds = new Set(result.events.map((event) => event.kind));
    expect(kinds.has("store_read")).toBe(true);
    expect(kinds.has("cache_expired")).toBe(true);
  });
});
