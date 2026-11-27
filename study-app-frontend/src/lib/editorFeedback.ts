/** Keep Python's user-facing diagnosis without leaking the harness or its traceback. */
export function editorRunError(error?: string): string | undefined {
  if (!error) return undefined;
  if (error.includes("needs a top-level function") || error.includes("No callable method"))
    return "Add a top-level function or a method in class Solution that matches the problem's inputs.";
  if (/timeout|time limit|timed out/i.test(error))
    return "Your code took too long. Check for an infinite loop or try a smaller test case.";
  const diagnosis = error.trim().split("\n").reverse().find((line) =>
    /^[A-Za-z]*(Error|Exception|Interrupt|Iteration):/.test(line.trim()),
  );
  return diagnosis?.trim() ?? "Could not run this code. Check your function and inputs, then try again.";
}
