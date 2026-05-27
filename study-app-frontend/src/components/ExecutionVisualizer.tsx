import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SerializedValue, TraceResult } from "../lib/pyodideRunner";

function VizValue({ value }: { value: SerializedValue }) {
  switch (value.type) {
    case "none":
      return <span className="lc-viz-val lc-viz-val--none">None</span>;
    case "bool":
      return (
        <span className={`lc-viz-val lc-viz-val--bool ${value.value ? "lc-viz-val--true" : "lc-viz-val--false"}`}>
          {String(value.value)}
        </span>
      );
    case "number":
      return <span className="lc-viz-val lc-viz-val--num">{value.value}</span>;
    case "string":
      return (
        <span className="lc-viz-val lc-viz-val--str">
          &ldquo;{value.value.length > 40 ? value.value.slice(0, 40) + "…" : value.value}&rdquo;
        </span>
      );
    case "list":
    case "tuple": {
      if (value.value.length === 0)
        return <span className="lc-viz-val lc-viz-val--none">{value.type === "tuple" ? "()" : "[]"}</span>;
      const allPrimitive = value.value.every(
        (v) => v.type === "number" || v.type === "string" || v.type === "bool" || v.type === "none",
      );
      if (allPrimitive) {
        return (
          <div className="lc-viz-array">
            {value.value.map((v, i) => (
              <div key={i} className="lc-viz-array-cell">
                <VizValue value={v} />
                <small>{i}</small>
              </div>
            ))}
            {value.length > 30 ? (
              <div className="lc-viz-array-cell lc-viz-array-cell--more">+{value.length - 30}</div>
            ) : null}
          </div>
        );
      }
      return (
        <div className="lc-viz-nested-list">
          {value.value.map((v, i) => (
            <div key={i} className="lc-viz-nested-row">
              <small className="lc-viz-nested-idx">[{i}]</small>
              <VizValue value={v} />
            </div>
          ))}
          {value.length > 30 ? <div className="lc-viz-nested-more">+{value.length - 30} more</div> : null}
        </div>
      );
    }
    case "set":
      return (
        <div className="lc-viz-array lc-viz-array--set">
          {value.value.map((v, i) => (
            <div key={i} className="lc-viz-array-cell">
              <VizValue value={v} />
            </div>
          ))}
          {value.length > 20 ? (
            <div className="lc-viz-array-cell lc-viz-array-cell--more">+{value.length - 20}</div>
          ) : null}
        </div>
      );
    case "dict":
      return (
        <div className="lc-viz-dict">
          {Object.entries(value.value).map(([k, v]) => (
            <div key={k} className="lc-viz-dict-row">
              <span className="lc-viz-dict-key">{k}</span>
              <span className="lc-viz-dict-arrow">→</span>
              <VizValue value={v} />
            </div>
          ))}
          {value.length > 15 ? <div className="lc-viz-dict-more">+{value.length - 15} more</div> : null}
        </div>
      );
    case "other":
      return <span className="lc-viz-val lc-viz-val--other">{value.repr}</span>;
    default:
      return null;
  }
}

export function ExecutionVisualizer({
  code,
  trace,
  onClose,
}: {
  code: string;
  trace: TraceResult;
  onClose: () => void;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const codeLines = code.split("\n");
  const totalSteps = trace.steps.length;
  const atEnd = stepIdx >= totalSteps;
  const step = atEnd ? null : trace.steps[stepIdx];

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [stepIdx]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setStepIdx((i) => Math.min(totalSteps, i + 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setStepIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [totalSteps, onClose]);

  const activeLine = step?.line ?? null;

  return (
    <>
      <div className="lc-viz-overlay" onClick={onClose} />
      <div className="lc-viz-modal" role="dialog" aria-modal="true" aria-label="Execution visualizer">
        <div className="lc-viz-header">
          <div className="lc-viz-header-left">
            <span className="lc-viz-title">Execution trace</span>
            {step ? <span className="lc-viz-method-badge">{step.method}()</span> : null}
          </div>
          <div className="lc-viz-header-right">
            <span className="lc-viz-step-label">
              {atEnd ? "Finished" : `Step ${stepIdx + 1} / ${totalSteps}`}
            </span>
            <button type="button" className="lc-kojo-close" onClick={onClose} aria-label="Close visualizer">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="lc-viz-body">
          <div className="lc-viz-code-panel">
            {codeLines.map((line, i) => {
              const lineNum = i + 1;
              const isActive = lineNum === activeLine;
              return (
                <div
                  key={i}
                  ref={isActive ? activeLineRef : null}
                  className={`lc-viz-code-line${isActive ? " lc-viz-code-line--active" : ""}`}
                >
                  <span className="lc-viz-line-num">{lineNum}</span>
                  <pre className="lc-viz-line-code">{line || " "}</pre>
                </div>
              );
            })}
          </div>

          <div className="lc-viz-vars-panel">
            {atEnd ? (
              <div className="lc-viz-result">
                <span className="lc-viz-result-label">Result</span>
                <code className="lc-viz-result-value">{trace.result ?? "None"}</code>
                {trace.error ? <pre className="lc-viz-error">{trace.error}</pre> : null}
              </div>
            ) : step && Object.keys(step.locals).length > 0 ? (
              Object.entries(step.locals).map(([name, value]) => (
                <div key={name} className="lc-viz-var">
                  <span className="lc-viz-var-name">{name}</span>
                  <div className="lc-viz-var-value">
                    <VizValue value={value} />
                  </div>
                </div>
              ))
            ) : (
              <p className="lc-viz-empty-vars">No local variables yet</p>
            )}
          </div>
        </div>

        <div className="lc-viz-nav">
          <button
            type="button"
            className="lc-viz-nav-btn"
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            disabled={stepIdx === 0}
            aria-label="Previous step"
          >
            <ChevronLeft size={18} />
          </button>
          <input
            type="range"
            className="lc-viz-slider"
            min={0}
            max={totalSteps}
            value={stepIdx}
            onChange={(e) => setStepIdx(Number(e.target.value))}
            aria-label="Step slider"
          />
          <button
            type="button"
            className="lc-viz-nav-btn"
            onClick={() => setStepIdx((i) => Math.min(totalSteps, i + 1))}
            disabled={atEnd}
            aria-label="Next step"
          >
            <ChevronRight size={18} />
          </button>
          <span className="lc-viz-nav-hint">← → to step</span>
        </div>
      </div>
    </>
  );
}
