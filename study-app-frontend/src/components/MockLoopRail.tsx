import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  DEBRIEF_STATION,
  LOOP_STAGES,
  formatLoopDuration,
  totalLoopMinutes,
  type LoopStageKey,
} from "../data/mockInterviewLoop";

/**
 * The loop spine: one shared vertical rail that carries the whole Mock Interview
 * feature. Stations are the stages of a real SWE loop, and the rail segment under
 * each station is sized from that stage's actual time budget, so the shape of the
 * rail is the time estimate. Turning a stage off collapses its segment.
 *
 *  - LoopStation    one row. The only place the gutter/node/segment DOM is written.
 *  - MockLoopRail   vertical and interactive, on the setup page
 *  - MockLoopTrack  the same rail laid flat, in stage headers and history rows
 *
 * The stage list itself lives in `data/mockInterviewLoop.ts`.
 */

/**
 * Rail segment height in px. Sublinear: a 90 minute stage has to read as clearly
 * the longest without opening a crater of dead space beside it, and the 2 minute
 * one still has to be visible. Rows never shrink below their own content.
 */
function stationHeight(minutes: number): number {
  return Math.round(18 + Math.sqrt(minutes) * 6);
}

export function LoopStation({
  icon: Icon,
  index,
  label,
  trailing,
  description,
  minutes,
  on = true,
  terminal = false,
  order,
  className = "",
  onToggle,
  pressed,
}: {
  icon: LucideIcon;
  /** Position in the loop, or null for the debrief, which is not a stage you sit. */
  index: number | null;
  label: string;
  /** The right-hand slot: a time budget, the loop total, or a verdict badge. */
  trailing?: ReactNode;
  description?: string;
  /** Drives the segment length. Omit for rows that do not encode a duration. */
  minutes?: number;
  on?: boolean;
  terminal?: boolean;
  /** Place in the entrance stagger. Defaults to `index`, which is right for stages. */
  order?: number;
  className?: string;
  onToggle?: () => void;
  pressed?: boolean;
}) {
  const Body = onToggle ? "button" : "div";
  return (
    <li
      className={[
        "loop-station",
        on ? "is-on" : "",
        terminal ? "loop-station--terminal" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          // --station-h is the rail segment length (the time), --station-i drives the
          // entrance stagger. Both are read from CSS so the rules stay in one place.
          ...(minutes === undefined ? {} : { "--station-h": `${on ? stationHeight(minutes) : 0}px` }),
          "--station-i": order ?? index ?? 0,
        } as React.CSSProperties
      }
    >
      <div className="loop-gutter" aria-hidden="true">
        <span className="loop-node">
          <Icon size={13} />
        </span>
        {!terminal && <span className="loop-segment" />}
      </div>
      <Body
        {...(onToggle
          ? { type: "button" as const, onClick: onToggle, "aria-pressed": pressed }
          : {})}
        className={`loop-station-body${onToggle ? "" : " loop-station-body--static"}`}
      >
        <span className="loop-station-head">
          <span className="loop-station-index">{index === null ? "--" : String(index).padStart(2, "0")}</span>
          <span className="loop-station-label">{label}</span>
          {trailing}
        </span>
        {description && <span className="loop-station-desc">{description}</span>}
      </Body>
    </li>
  );
}

/** The mono time cluster: a value and its unit, used on every station that has one. */
function LoopTime({ value, unit, total = false }: { value: string; unit: string; total?: boolean }) {
  return (
    <span className={`loop-station-time${total ? " loop-station-time--total" : ""}`}>
      <span className="loop-num">{value}</span>
      <span className="loop-unit">{unit}</span>
    </span>
  );
}

export function MockLoopRail({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (key: LoopStageKey) => void;
}) {
  return (
    <ol className="loop-spine" aria-label="Interview loop stages">
      {LOOP_STAGES.map((stage, i) => {
        const on = selected.includes(stage.key);
        return (
          <LoopStation
            key={stage.key}
            icon={stage.icon}
            index={i + 1}
            label={stage.label}
            description={stage.description}
            minutes={stage.minutes}
            on={on}
            pressed={on}
            onToggle={() => onToggle(stage.key)}
            trailing={<LoopTime value={String(stage.minutes).padStart(2, "0")} unit="min" />}
          />
        );
      })}

      <LoopStation
        icon={DEBRIEF_STATION.icon}
        index={null}
        order={LOOP_STAGES.length + 1}
        label={DEBRIEF_STATION.label}
        description={DEBRIEF_STATION.description}
        terminal
        trailing={<LoopTime value={formatLoopDuration(totalLoopMinutes(selected))} unit="total" total />}
      />
    </ol>
  );
}

/**
 * Where the reader sits in the loop, when they cannot change it.
 * `current` is the live stage, or "done" for a finished loop, or "unknown" when the
 * loop is unfinished but the position was never recorded (a history row).
 */
export function MockLoopTrack({
  stages,
  current,
  compact = false,
}: {
  stages: string[];
  current: LoopStageKey | "summary" | "done" | "unknown";
  compact?: boolean;
}) {
  const run = LOOP_STAGES.filter((s) => stages.includes(s.key));
  const currentIdx =
    current === "unknown" ? -1 : current === "done" || current === "summary" ? run.length : run.findIndex((s) => s.key === current);

  const stations = [
    ...run.map((s, i) => ({
      key: s.key as string,
      short: s.short,
      status: current === s.key ? "current" : i < currentIdx ? "done" : "upcoming",
    })),
    {
      key: "summary",
      short: DEBRIEF_STATION.short,
      status: current === "summary" ? "current" : current === "done" ? "done" : "upcoming",
    },
  ];

  return (
    <ol className={`loop-track${compact ? " loop-track--compact" : ""}`} aria-label="Loop progress">
      {stations.map((station) => (
        <li key={station.key} className={`loop-track-station is-${station.status}`}>
          <span className="loop-track-node" aria-hidden="true" />
          <span className="loop-track-label">{station.short}</span>
        </li>
      ))}
    </ol>
  );
}
