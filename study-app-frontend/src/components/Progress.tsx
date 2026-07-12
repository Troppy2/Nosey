/**
 * Progress indicators for waits with a known total or clear stages (roughly
 * 3s and up): module generation, multi-step processing, uploads, grading. Pass
 * `value` (+ `max`) when completion is countable; omit it for an indeterminate
 * sweep. For waits past ~10s always pair the bar with `label`/`detail` text
 * that tells the user what is still happening.
 *
 * When the work is not countable but its shape is known (grading walks a fixed
 * pipeline; so does generation), drive the bar with `useStagedProgress` and
 * show it in a `ProgressOverlay`.
 *
 * Reuses the app's existing `.progress-track` / `.progress-fill` styling; the
 * raw divs in Flashcards/Matching/TakeTest keep working unchanged.
 */

import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ProgressBarProps = {
  /** Completed amount. Omit (or null) for an indeterminate sweep. */
  value?: number | null;
  max?: number;
  /** What is happening, e.g. "Writing lessons". */
  label?: string;
  /** Right-aligned status, e.g. "3 of 8 ready". */
  detail?: string;
};

export function ProgressBar({ value, max = 100, label, detail }: ProgressBarProps) {
  const determinate = typeof value === "number" && Number.isFinite(value) && max > 0;
  const pct = determinate ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress-block">
      {label || detail ? (
        <div className="progress-head">
          <span>{label}</span>
          {detail ? <span className="progress-detail">{detail}</span> : null}
        </div>
      ) : null}
      <div
        className={`progress-track${determinate ? "" : " progress-track--indeterminate"}`}
        role="progressbar"
        aria-label={label ?? "Progress"}
        aria-valuemin={0}
        aria-valuemax={determinate ? max : undefined}
        aria-valuenow={determinate ? Math.round(value) : undefined}
      >
        <div
          className="progress-fill"
          style={determinate ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

/** One step of a pipeline the user is waiting on. */
export type ProgressStage = {
  /** What the app is doing, in the user's terms: "Reading your written answers". */
  label: string;
  /** Roughly how long this step takes. Only the ratio between stages matters. */
  seconds: number;
};

/**
 * Drives a bar for a wait whose duration is unknown but whose *shape* is known:
 * grading and generation both walk a fixed pipeline, we just cannot say how
 * long the LLM will take. Elapsed time walks `stages`, and the bar eases toward
 * `ceiling` without ever arriving, so an unusually slow response never looks
 * finished. `done` runs it the rest of the way to 100.
 *
 * The bar is an estimate, and it stays an honest one: the stages are the real
 * pipeline, and only the caller's `done` can claim completion. If the work
 * overruns, the last stage holds rather than inventing a new one.
 */
export function useStagedProgress(
  stages: ProgressStage[],
  { running, done, ceiling = 92 }: { running: boolean; done: boolean; ceiling?: number },
) {
  const [elapsed, setElapsed] = useState(0);

  const total = useMemo(
    () => stages.reduce((sum, stage) => sum + stage.seconds, 0) || 1,
    [stages],
  );

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 120);
    return () => window.clearInterval(timer);
  }, [running]);

  // Asymptotic: fast off the line, slower the longer it runs, never reaching
  // the ceiling. At the expected duration it sits around 85% of the ceiling.
  const approach = 1 - Math.exp(-1.9 * (elapsed / total));
  const percent = done ? 100 : Math.min(ceiling, approach * ceiling);

  let activeStage = 0;
  let boundary = 0;
  for (let i = 0; i < stages.length; i += 1) {
    boundary += stages[i].seconds;
    activeStage = i;
    if (elapsed < boundary) break;
  }

  return {
    percent,
    /** Index of the running stage, or `stages.length` once `done`. */
    activeStage: done ? stages.length : activeStage,
  };
}

/**
 * Blocking full-screen progress for an action the user cannot work around:
 * they submitted, and the only thing to do is wait. Shows the bar plus the
 * pipeline as a checklist that ticks off, so the wait has visible structure
 * instead of one undifferentiated spinner.
 *
 * Use this only when the wait genuinely blocks. Anything the user could keep
 * working through belongs in an inline `ProgressBar` or `LoadingNotice`.
 */
export function ProgressOverlay({
  eyebrow,
  title,
  note,
  percent,
  stages,
  activeStage,
}: {
  /** Short kicker above the title, e.g. "Marking". */
  eyebrow?: string;
  title: string;
  /** Standing line under the checklist: what to expect, or what not to do. */
  note?: string;
  percent: number;
  stages: ProgressStage[];
  activeStage: number;
}) {
  return (
    <div className="progress-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="progress-overlay-card">
        <div className="progress-overlay-head">
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h2>{title}</h2>
        </div>

        <ProgressBar value={percent} max={100} detail={`${Math.round(percent)}%`} />

        <ol className="progress-stages" aria-live="polite">
          {stages.map((stage, i) => {
            const state = i < activeStage ? "done" : i === activeStage ? "active" : "pending";
            return (
              <li key={stage.label} className={`progress-stage progress-stage--${state}`}>
                <span className="progress-stage-mark" aria-hidden="true">
                  {state === "done" ? <Check size={12} strokeWidth={3} /> : null}
                  {state === "active" ? <span className="loader loader--xs" /> : null}
                </span>
                {stage.label}
              </li>
            );
          })}
        </ol>

        {note ? <p className="progress-overlay-note muted small">{note}</p> : null}
      </div>
    </div>
  );
}
