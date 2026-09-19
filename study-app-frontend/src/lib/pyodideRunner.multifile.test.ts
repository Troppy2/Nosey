import { beforeAll, describe, expect, it } from "vitest";

import { runPythonMultiFile } from "./pyodideRunner";

/**
 * The one integration test of the System Design runner. It boots a real Python
 * runtime, so it is opt-in: `npm test` stays fast and offline, and
 * `npm run test:pyodide` runs this.
 *
 * It drives runPythonMultiFile through the same entry point the app uses; only
 * the Pyodide instance is supplied directly (the app loads it from a CDN script
 * tag, which jsdom will not execute).
 */
const ENABLED = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.SD_PYODIDE_TESTS,
);

const ADDER = `
import sim

def add(a, b):
    sim.record("add", a=a, b=b)
    sim.tick()
    return a + b
`;

const DOUBLER = `
from adder import add

def double(n):
    return add(n, n)
`;

const TESTS = `
from doubler import double

def run_tests():
    results = []
    results.append(("doubles 2", double(2) == 4, "" if double(2) == 4 else "got " + str(double(2))))
    results.append(("doubles 0", double(0) == 0, ""))
    return results
`;

describe.skipIf(!ENABLED)("runPythonMultiFile (integration)", () => {
  beforeAll(async () => {
    const packageName = "pyodide";
    const pyodideModule = await import(/* @vite-ignore */ packageName);
    const pyodide = await pyodideModule.loadPyodide();
    (window as unknown as { __noseyPyodide?: Promise<unknown> }).__noseyPyodide =
      Promise.resolve(pyodide);
  }, 120_000);

  it("passes a two-file fixture end to end", async () => {
    const result = await runPythonMultiFile({
      files: { "adder.py": ADDER, "doubler.py": DOUBLER },
      testModule: TESTS,
    });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.cases).toHaveLength(2);
  });

  it("returns ok false with a per-case message for a broken user file, and throws nothing", async () => {
    const result = await runPythonMultiFile({
      files: { "adder.py": ADDER.replace("return a + b", "return a * b"), "doubler.py": DOUBLER },
      testModule: TESTS,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeUndefined();
    const failed = result.cases.find((testCase) => !testCase.passed);
    expect(failed?.message).toBeTruthy();
  });

  it("surfaces a syntax error as result.error and not as a thrown exception", async () => {
    const result = await runPythonMultiFile({
      files: { "adder.py": "def add(a, b)\n    return a + b\n", "doubler.py": DOUBLER },
      testModule: TESTS,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SyntaxError/);
    expect(result.cases).toEqual([]);
  });

  it("surfaces sim.record calls in result.events", async () => {
    const result = await runPythonMultiFile({
      files: { "adder.py": ADDER, "doubler.py": DOUBLER },
      testModule: TESTS,
    });
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((event) => event.kind === "add")).toBe(true);
    expect(result.events[0].payload).toMatchObject({ a: 2, b: 2 });
  });

  it("gives identical results for two consecutive runs", async () => {
    const args = { files: { "adder.py": ADDER, "doubler.py": DOUBLER }, testModule: TESTS };
    const first = await runPythonMultiFile(args);
    const second = await runPythonMultiFile(args);
    expect(second.ok).toBe(first.ok);
    expect(second.cases).toEqual(first.cases);
    expect(second.events).toEqual(first.events);
  });

  it("does not let a second run see files the first run wrote", async () => {
    await runPythonMultiFile({
      files: { "leftover.py": "VALUE = 1\n" },
      testModule: "def run_tests():\n    return [('noop', True, '')]\n",
    });
    const second = await runPythonMultiFile({
      files: {},
      testModule: "import leftover\n\ndef run_tests():\n    return [('noop', True, '')]\n",
    });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/ModuleNotFoundError|ImportError/);
  });
});
