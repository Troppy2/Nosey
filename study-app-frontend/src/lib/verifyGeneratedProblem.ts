import type { LCGeneratedCustomProblem } from "./types";
import type { RunnerResult } from "./pyodideRunner";

export type ProblemFailure = { label: string; input: string; expected: string; actual: string; error: string };

export type VerifyOutcome = {
  problem: LCGeneratedCustomProblem;
  /** "passed": the reference passes every test. "trimmed": tests the reference never
      agreed with were dropped. "failed": it still does not run; do not save it as is. */
  status: "passed" | "trimmed" | "failed";
  repairs: number;
};

type RunFn = (code: string, cases: { label: string; inputText: string; expectedOutput: string }[]) => Promise<RunnerResult>;
type RepairFn = (problem: LCGeneratedCustomProblem, failures: ProblemFailure[]) => Promise<LCGeneratedCustomProblem>;

/** Repairs per problem. Each one is a single Kojo call, so this caps the cost. */
export const MAX_REPAIRS = 2;
const MIN_TESTS = 2;

function casesOf(problem: LCGeneratedCustomProblem) {
  return problem.test_cases.map((tc, i) => ({ label: `Test ${i + 1}`, inputText: tc.input_text, expectedOutput: tc.output_text }));
}

function failuresOf(problem: LCGeneratedCustomProblem, result: RunnerResult): ProblemFailure[] {
  const cases = casesOf(problem);
  if (result.error && !result.cases?.length) {
    return [{ label: "Run", input: cases[0]?.inputText ?? "", expected: cases[0]?.expectedOutput ?? "", actual: "", error: result.error.slice(-1500) }];
  }
  return (result.cases ?? [])
    .filter((c) => !c.passed)
    .map((c) => {
      const source = cases.find((x) => x.label === c.label);
      return { label: c.label, input: source?.inputText ?? "", expected: c.expected, actual: c.actual, error: "" };
    });
}

/**
 * Kojo checks a problem it wrote: run its reference solution against its own tests in
 * the editor's runner. When they disagree, Kojo is shown the exact failures and fixes
 * the problem, up to MAX_REPAIRS times. If it still fails, tests the reference never
 * passed are dropped as long as MIN_TESTS remain; otherwise the problem is "failed".
 */
export async function verifyGeneratedProblem(
  generated: LCGeneratedCustomProblem,
  run: RunFn,
  repair: RepairFn,
): Promise<VerifyOutcome> {
  let problem = generated;
  let repairs = 0;
  for (;;) {
    const reference = problem.reference_solution?.trim() ?? "";
    const result: RunnerResult = reference && problem.test_cases.length
      ? await run(reference, casesOf(problem))
      : { ok: false, output: "", error: "There is no reference solution or no test cases.", cases: [] };
    if (result.ok) return { problem, status: "passed", repairs };
    if (repairs >= MAX_REPAIRS) {
      const passing = new Set((result.cases ?? []).filter((c) => c.passed).map((c) => c.label));
      const kept = problem.test_cases.filter((_, i) => passing.has(`Test ${i + 1}`));
      if (kept.length >= MIN_TESTS) return { problem: { ...problem, test_cases: kept }, status: "trimmed", repairs };
      return { problem, status: "failed", repairs };
    }
    repairs += 1;
    try {
      problem = await repair(problem, failuresOf(problem, result));
    } catch {
      return { problem, status: "failed", repairs };
    }
  }
}
