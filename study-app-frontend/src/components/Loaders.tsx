/**
 * Spinners and micro-loaders for indeterminate waits: button actions, widget
 * refreshes, small inline fetches, and longer waits where nothing is countable.
 *
 * These wrap the app's existing `.loader` ring so every spinner shares one
 * look. For content-heavy page loads use the skeletons in Skeletons.tsx; for
 * waits with a known total or clear stages use Progress.tsx.
 */

import { useEffect, useState } from "react";

type SpinnerSize = "xs" | "sm" | "md";

const SIZE_CLASS: Record<SpinnerSize, string> = {
  xs: "loader loader--xs",
  sm: "loader loader--sm",
  md: "loader",
};

/** Bare ring spinner. `md` (24px) for blocks, `sm` (14px) / `xs` (10px) inline. */
export function Spinner({
  size = "md",
  label = "Loading",
}: {
  size?: SpinnerSize;
  label?: string;
}) {
  return <span className={SIZE_CLASS[size]} role="status" aria-label={label} />;
}

/**
 * Spinner + short text for inline contexts, e.g. inside a button while its
 * action runs: {saving ? <InlineLoading label="Saving…" /> : "Save changes"}.
 * Keep the label an active verb form of the action it replaces.
 */
export function InlineLoading({ label }: { label: string }) {
  return (
    <span className="inline-loading" role="status">
      <span className="loader loader--xs" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Spinner + copy for a wait the user has to sit through (roughly 3s and up)
 * with nothing countable to show: an LLM call, a file parse, a provider round
 * trip. The copy is the point, not the spinner.
 *
 * `estimate` sets the expectation up front so the wait has a shape. Once it
 * runs past `slowAfterMs` the copy switches to `slowNote`, which is what keeps
 * a long wait reading as "still working" instead of "stuck" and is the whole
 * reason this exists. Set `slowAfterMs` a little past the honest typical time:
 * the switch should feel like the app noticing, not like a scheduled excuse.
 *
 * Both notes are plain sentences about what is happening. Never promise a
 * deadline the backend cannot keep.
 */
export function LoadingNotice({
  title,
  estimate,
  slowNote,
  slowAfterMs = 12000,
  compact = false,
}: {
  /** What is happening, as an active phrase: "Grading your answers". */
  title: string;
  /** Up-front expectation: "This usually takes about 10 seconds." */
  estimate?: string;
  /** Replaces `estimate` after `slowAfterMs`. Omit to keep `estimate` throughout. */
  slowNote?: string;
  slowAfterMs?: number;
  /** Row layout for inline placement under a button or inside a panel. */
  compact?: boolean;
}) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!slowNote) return;
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), slowAfterMs);
    return () => window.clearTimeout(timer);
  }, [slowNote, slowAfterMs, title]);

  const note = slow && slowNote ? slowNote : estimate;

  return (
    <div
      className={`loading-notice${compact ? " loading-notice--compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className={compact ? "loader loader--sm" : "loader"} aria-hidden="true" />
      <div className="loading-notice-text">
        <strong>{title}</strong>
        {note ? (
          // Keyed so the swap to slowNote fades in rather than snapping.
          <span className="loading-notice-hint muted small" key={slow ? "slow" : "estimate"}>
            {note}
          </span>
        ) : null}
      </div>
    </div>
  );
}
