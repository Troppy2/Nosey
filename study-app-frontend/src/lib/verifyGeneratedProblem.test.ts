import { describe, expect, it, vi } from "vitest";

import type { RunnerResult } from "./pyodideRunner";
import type { LCGeneratedCustomProblem } from "./types";
import { MAX_REPAIRS, verifyGeneratedProblem, type ProblemFailure } from "./verifyGeneratedProblem";

type Repair = (p: LCGeneratedCustomProblem, f: ProblemFailure[]) => Promise<LCGeneratedCustomProblem>;

const problem = (outputs: string[], reference = "class Solution: ..."): LCGeneratedCustomProblem => ({
  title: "Count Evens",
  topic: "Arrays",
  difficulty: "Easy",
  description: "",
  starter_code: "",
  reference_solution: reference,
  test_cases: outputs.map((output_text, i) => ({ input_text: `nums = [${i}]`, output_text })),
});

// A fake runner: a test passes when its expected output is "ok".
const run = vi.fn(async (_code: string, cases: { label: string; expectedOutput: string }[]): Promise<RunnerResult> => {
  const results = cases.map((c) => ({ label: c.label, passed: c.expectedOutput === "ok", actual: "ok", expected: c.expectedOutput }));
  return { ok: results.every((r) => r.passed), output: "", cases: results } as RunnerResult;
});

describe("verifyGeneratedProblem", () => {
  it("passes a problem whose reference solution passes its tests, with no repair", async () => {
    const repair = vi.fn<Repair>();
    const outcome = await verifyGeneratedProblem(problem(["ok", "ok", "ok"]), run, repair);
    expect(outcome.status).toBe("passed");
    expect(repair).not.toHaveBeenCalled();
  });

  it("sends Kojo the failures and keeps the fixed problem", async () => {
    const repair = vi.fn<Repair>(async () => problem(["ok", "ok", "ok"]));
    const outcome = await verifyGeneratedProblem(problem(["ok", "bad", "ok"]), run, repair);
    expect(outcome).toMatchObject({ status: "passed", repairs: 1 });
    expect(repair.mock.calls[0][1]).toEqual([{ label: "Test 2", input: "nums = [1]", expected: "bad", actual: "ok", error: "" }]);
  });

  it("asks for a reference solution when there is none", async () => {
    const repair = vi.fn<Repair>(async () => problem(["ok", "ok"]));
    const outcome = await verifyGeneratedProblem(problem(["ok", "ok"], ""), run, repair);
    expect(outcome.status).toBe("passed");
    expect(repair.mock.calls[0]?.[1][0]?.error).toMatch(/no reference solution/);
  });

  it("stops after MAX_REPAIRS and drops the tests that never agreed", async () => {
    const repair = vi.fn<Repair>(async () => problem(["ok", "bad", "ok"]));
    const outcome = await verifyGeneratedProblem(problem(["ok", "bad", "ok"]), run, repair);
    expect(repair).toHaveBeenCalledTimes(MAX_REPAIRS);
    expect(outcome.status).toBe("trimmed");
    expect(outcome.problem.test_cases.map((t) => t.output_text)).toEqual(["ok", "ok"]);
  });

  it("fails when too few tests would be left, or the repair call fails", async () => {
    const stillBad = vi.fn<Repair>(async () => problem(["bad", "bad", "ok"]));
    expect((await verifyGeneratedProblem(problem(["bad", "bad", "ok"]), run, stillBad)).status).toBe("failed");
    const down = vi.fn<Repair>(async () => { throw new Error("503"); });
    expect((await verifyGeneratedProblem(problem(["bad"]), run, down)).status).toBe("failed");
  });
});
