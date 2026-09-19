import { describe, expect, it } from "vitest";

import {
  SD_SIM_MODULE_NAME,
  SD_TEST_MODULE_NAME,
  SD_WORK_DIR,
  buildHarnessFiles,
  computeOk,
  normalizeSimEvents,
  parseTestResults,
} from "./sdHarness";

const TEST_MODULE = "def run_tests():\n    return []\n";

describe("buildHarnessFiles", () => {
  it("writes mock packages before user files", () => {
    const built = buildHarnessFiles({
      files: { "cache.py": "user" },
      testModule: TEST_MODULE,
      mockPackages: { "fakeredis.py": "mock" },
    });
    const paths = built.map((file) => file.path);
    expect(paths.indexOf(`${SD_WORK_DIR}/fakeredis.py`)).toBeLessThan(
      paths.indexOf(`${SD_WORK_DIR}/cache.py`),
    );
  });

  it("always includes sim.py even when mockPackages is empty", () => {
    const built = buildHarnessFiles({ files: { "cache.py": "user" }, testModule: TEST_MODULE });
    const sim = built.find((file) => file.path === `${SD_WORK_DIR}/${SD_SIM_MODULE_NAME}`);
    expect(sim).toBeDefined();
    expect(sim?.contents).toContain("def record(");
  });

  it("places the test module last so nothing can shadow it", () => {
    const built = buildHarnessFiles({
      files: { "cache.py": "user" },
      testModule: TEST_MODULE,
      mockPackages: { "fakeredis.py": "mock" },
    });
    expect(built[built.length - 1]).toEqual({
      path: `${SD_WORK_DIR}/${SD_TEST_MODULE_NAME}`,
      contents: TEST_MODULE,
    });
  });

  it("refuses a user file named _sd_tests.py", () => {
    expect(() =>
      buildHarnessFiles({ files: { [SD_TEST_MODULE_NAME]: "cheat" }, testModule: TEST_MODULE }),
    ).toThrow(/reserved/i);
  });

  it("refuses a user file that shadows a mock package", () => {
    expect(() =>
      buildHarnessFiles({
        files: { "fakeredis.py": "shadow" },
        testModule: TEST_MODULE,
        mockPackages: { "fakeredis.py": "mock" },
      }),
    ).toThrow(/provided module/i);
  });

  it("refuses a user file that shadows sim.py", () => {
    expect(() =>
      buildHarnessFiles({ files: { "sim.py": "shadow" }, testModule: TEST_MODULE }),
    ).toThrow(/provided module/i);
  });

  it("refuses a file name with a path separator", () => {
    expect(() =>
      buildHarnessFiles({ files: { "../escape.py": "x" }, testModule: TEST_MODULE }),
    ).toThrow(/invalid module name/i);
  });

  it("refuses a file that is not a python module", () => {
    expect(() =>
      buildHarnessFiles({ files: { "notes.md": "x" }, testModule: TEST_MODULE }),
    ).toThrow(/python modules/i);
  });
});

describe("parseTestResults", () => {
  it("maps 3-tuples to cases", () => {
    const result = parseTestResults([
      ["hits count", true, ""],
      ["evicts the oldest", false, "expected b, got a"],
    ]);
    expect(result.error).toBeUndefined();
    expect(result.cases).toEqual([
      { name: "hits count", passed: true },
      { name: "evicts the oldest", passed: false, message: "expected b, got a" },
    ]);
  });

  it("tolerates a 2-tuple with no message", () => {
    const result = parseTestResults([["hits count", true]]);
    expect(result.cases).toEqual([{ name: "hits count", passed: true }]);
  });

  it("returns an error for a non-list return value", () => {
    expect(parseTestResults({ ok: true }).error).toBeTruthy();
    expect(parseTestResults(null).error).toBeTruthy();
  });

  it("returns an error for an empty list", () => {
    const result = parseTestResults([]);
    expect(result.cases).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("returns an error for a malformed entry", () => {
    expect(parseTestResults([["only a name"]]).error).toBeTruthy();
    expect(parseTestResults(["not a tuple"]).error).toBeTruthy();
  });
});

describe("normalizeSimEvents", () => {
  it("sorts by t then insertion order", () => {
    const events = normalizeSimEvents([
      { t: 2, kind: "second", payload: {} },
      { t: 1, kind: "first", payload: {} },
      { t: 2, kind: "third", payload: {} },
    ]);
    expect(events.map((event) => event.kind)).toEqual(["first", "second", "third"]);
  });

  it("drops entries missing kind or t", () => {
    const events = normalizeSimEvents([
      { kind: "no-time", payload: {} },
      { t: 1, payload: {} },
      { t: 1, kind: "", payload: {} },
      { t: 1, kind: "kept", payload: {} },
    ]);
    expect(events.map((event) => event.kind)).toEqual(["kept"]);
  });

  it("coerces payload to a plain object", () => {
    const events = normalizeSimEvents([
      { t: 0, kind: "a" },
      { t: 1, kind: "b", payload: "not an object" },
      { t: 2, kind: "c", payload: ["also", "not"] },
    ]);
    expect(events.map((event) => event.payload)).toEqual([{}, {}, {}]);
  });

  it("returns an empty list for a non-list input", () => {
    expect(normalizeSimEvents(undefined)).toEqual([]);
    expect(normalizeSimEvents({ t: 1, kind: "a" })).toEqual([]);
  });
});

describe("computeOk", () => {
  it("is false when cases is empty", () => {
    expect(computeOk({ cases: [] })).toBe(false);
  });

  it("is false when any case failed", () => {
    expect(
      computeOk({ cases: [{ name: "a", passed: true }, { name: "b", passed: false }] }),
    ).toBe(false);
  });

  it("is false when error is set even if every case passed", () => {
    expect(computeOk({ cases: [{ name: "a", passed: true }], error: "boom" })).toBe(false);
  });

  it("is true only for a non-empty all-passing run with no error", () => {
    expect(computeOk({ cases: [{ name: "a", passed: true }] })).toBe(true);
  });
});
