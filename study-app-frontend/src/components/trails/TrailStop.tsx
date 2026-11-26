import type { CSSProperties, ReactNode } from "react";
import type { StopState } from "../../lib/trailView";

export type SignSide = "above" | "below" | "left" | "right";

/**
 * One stop on a trail: a round button on the path plus its wooden signpost.
 * Placed in percent of the scene so it scales with it; the button keeps a
 * 44px+ hit area at every size.
 */
export function TrailStop({
  position,
  side,
  kind,
  state,
  glyph,
  short,
  status,
  note,
  noteTone = "caution",
  selected,
  ariaLabel,
  onSelect,
}: {
  position: { left: string; top: string };
  side: SignSide;
  kind: "lesson" | "step" | "yarn" | "land" | "summit";
  state: StopState;
  glyph: ReactNode;
  short: string;
  status: string;
  /** Third signpost line (a waiting redo, a storm warning). */
  note?: string | null;
  noteTone?: "caution" | "positive";
  selected: boolean;
  ariaLabel: string;
  onSelect: () => void;
}) {
  const style = { left: position.left, top: position.top } as CSSProperties;
  return (
    <>
      <button
        type="button"
        className={`pt-stop pt-stop--${kind} is-${state}${selected ? " is-selected" : ""}`}
        style={style}
        aria-label={ariaLabel}
        aria-pressed={selected}
        onClick={onSelect}
      >
        {state === "current" && kind !== "yarn" && kind !== "summit" ? <span className="pt-stop-pulse" aria-hidden="true" /> : null}
        <span className="pt-stop-glyph" aria-hidden="true">
          {glyph}
        </span>
      </button>
      <div className={`pt-sign pt-sign--${side}${selected ? " is-selected" : ""}`} style={style} aria-hidden="true">
        <b>{short}</b>
        <span>{status}</span>
        {note ? <span className={`pt-sign-note pt-sign-note--${noteTone}`}>{note}</span> : null}
      </div>
    </>
  );
}
