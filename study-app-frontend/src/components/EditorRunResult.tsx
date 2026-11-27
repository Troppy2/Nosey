import { useState, type ReactNode } from "react";
import type { RunnerResult } from "../lib/pyodideRunner";

/** Submit verdicts read like LeetCode's ("Accepted", "Wrong answer"); Run stays a preview. */
export function resultTitle(result: RunnerResult, kind: "run" | "submit"): string {
  // An error stops the run part way, so a few passed cases are not a wrong answer.
  if (result.notice || !result.cases?.length || result.error) return result.output.replace(/\.$/, "");
  if (kind === "submit") return result.ok ? "Accepted" : "Wrong answer";
  return result.ok ? "All cases passed" : "Some cases failed";
}

export function EditorRunResult({ result, kind = "run", aside }: {
  result: RunnerResult;
  kind?: "run" | "submit";
  /** Shown under the verdict, before the cases (submission stats). */
  aside?: ReactNode;
}) {
  const [selected, setSelected] = useState<string>();
  const cases = result.cases ?? [];
  const active = cases.find((item) => item.label === selected) ?? cases.find((item) => !item.passed) ?? cases[0];
  const tone = result.notice ? "lc-runner-result--notice" : result.ok ? "lc-runner-result--ok" : "lc-runner-result--error";
  return <div className={"lc-runner-result " + tone}>
    <div className="lc-result-summary">
      <strong>{resultTitle(result, kind)}</strong>
      {cases.length ? <span>{cases.filter((item) => item.passed).length} / {cases.length} passed</span> : null}
    </div>
    {aside}
    {result.error ? <p className="lc-result-error">{result.error}</p> : null}
    {cases.length ? <>
      <div className="lc-case-tabs" role="tablist" aria-label="Test results">
        {cases.map((item, index) => <button type="button" role="tab" key={item.label} id={"lc-result-case-" + index} aria-selected={active?.label === item.label} aria-controls="lc-result-detail" tabIndex={active?.label === item.label ? 0 : -1} onClick={() => setSelected(item.label)}
          onKeyDown={(event) => {
            const offsets: Record<string, number> = {ArrowRight:index + 1, ArrowLeft:index - 1, Home:0, End:cases.length - 1};
            if (!(event.key in offsets)) return;
            event.preventDefault();
            const next = (offsets[event.key] + cases.length) % cases.length;
            setSelected(cases[next].label);
            document.getElementById("lc-result-case-" + next)?.focus();
          }}>
          <span className={"lc-result-dot " + (item.passed ? "is-passed" : "is-failed")} />
          {item.label.startsWith("Custom") ? item.label : "Case " + (index + 1)}<span className="lc-visually-hidden">{item.passed ? ": passed" : ": failed"}</span>
        </button>)}
      </div>
      {active ? <div id="lc-result-detail" role="tabpanel" aria-labelledby={"lc-result-case-" + cases.indexOf(active)} className="lc-result-detail">
        {active.input ? <div className="lc-result-input"><span>Input</span><pre>{active.input}</pre></div> : null}
        <div><span>Your output</span><pre className={active.passed ? undefined : "is-wrong"}>{active.actual}</pre></div>
        <div><span>Expected</span><pre>{active.expected}</pre></div>
      </div> : null}
    </> : null}
  </div>;
}
