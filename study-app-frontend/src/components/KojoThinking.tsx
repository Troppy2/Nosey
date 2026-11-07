import { AlertIcon, CheckIcon, ChevronRightIcon } from "../icons";
import type { KojoToolStep } from "../lib/types";
import "../styles/components/kojo-tools.css";
import { useEffect, useRef, useState } from "react";
import { MarkdownContent } from "./MarkdownContent";

// ── Staged thinking indicator ────────────────────────────────────────────────
// Shown while Kojo is working but before any answer text has streamed in. The
// label advances on a timer so a slow response reassures rather than stalls.
// Each stage names what Kojo is actually doing, in the interface's voice.

type Stage = { at: number; label: string };

const STAGES: Stage[] = [
  { at: 0, label: "Gathering notes" },
  { at: 1400, label: "Reading notes" },
  { at: 3200, label: "Crafting response" },
  { at: 7000, label: "Taking a little longer" },
  { at: 12000, label: "Almost done" },
];

export function KojoStagedThinking() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timers = STAGES.slice(1).map((stage, i) =>
      window.setTimeout(() => setIdx(i + 1), stage.at),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div className="kojo-staged" role="status" aria-live="polite">
      <span className="kojo-staged-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {/* key on idx so the label re-mounts and plays its enter animation */}
      <span key={idx} className="kojo-staged-label">
        {STAGES[idx].label}
      </span>
    </div>
  );
}

// ── Reasoning disclosure ─────────────────────────────────────────────────────
// A de-emphasized, collapsible view of Kojo's thinking pass. Auto-opens while
// the reasoning is streaming, then collapses once the answer begins so the
// answer stays the focus. The user can reopen it any time.

export function KojoReasoning({
  text,
  live,
  steps,
}: {
  text: string;
  live: boolean;
  steps?: KojoToolStep[];
}) {
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);

  useEffect(() => {
    if (live && !open) setOpen(true);
    if (wasLive.current && !live) setOpen(false); // collapse when thinking ends
    wasLive.current = live;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const toolSteps = steps ?? [];
  if (!text && !live && toolSteps.length === 0) return null;

  // Reasoning text split at each tool step's offset, so chips sit where Kojo
  // used the tool (GH #205).
  const segments: Array<{ kind: "text"; text: string } | { kind: "step"; step: KojoToolStep }> = [];
  let cursor = 0;
  for (const step of [...toolSteps].sort((a, b) => a.at - b.at || a.id - b.id)) {
    const at = Math.min(Math.max(step.at, cursor), text.length);
    if (at > cursor) segments.push({ kind: "text", text: text.slice(cursor, at) });
    segments.push({ kind: "step", step });
    cursor = at;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });

  const running = toolSteps.some((s) => s.status === "running");
  const summary = toolSteps.length > 0 ? `${toolSteps.length} step${toolSteps.length === 1 ? "" : "s"}` : null;

  return (
    <div className={`kojo-reasoning${open ? " kojo-reasoning--open" : ""}`}>
      <button
        type="button"
        className="kojo-reasoning-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRightIcon size={13} className="kojo-reasoning-chevron" aria-hidden="true" />
        <span className="kojo-reasoning-label">Reasoning</span>
        {summary && <span className="kojo-reasoning-count">{summary}</span>}
        {live && <span className="kojo-reasoning-live">{running ? "working" : "thinking"}</span>}
      </button>
      {open && (
        <div className="kojo-reasoning-body">
          {segments.map((seg, i) =>
            seg.kind === "text" ? (
              seg.text.trim() ? <MarkdownContent key={`t${i}`} content={seg.text} /> : null
            ) : (
              <KojoToolChip key={`s${seg.step.id}`} step={seg.step} />
            ),
          )}
          {live && <span className="kojo-caret" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}

// One tool call inside the reasoning disclosure. Expands to show what Kojo
// read or prepared.
function KojoToolChip({ step }: { step: KojoToolStep }) {
  const [open, setOpen] = useState(false);
  const expandable = !!step.detail;
  return (
    <div className={`kojo-tool-step kojo-tool-step--${step.status}`}>
      <button
        type="button"
        className="kojo-tool-chip"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
      >
        <span className="kojo-tool-chip-status" aria-hidden="true">
          {step.status === "running" ? (
            <span className="kojo-tool-chip-spinner" />
          ) : step.status === "error" ? (
            <AlertIcon size={12} />
          ) : (
            <CheckIcon size={12} />
          )}
        </span>
        <span className="kojo-tool-chip-label">{step.label}</span>
        {expandable && (
          <ChevronRightIcon
            size={11}
            className={`kojo-tool-chip-chevron${open ? " kojo-tool-chip-chevron--open" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>
      {open && step.detail && <div className="kojo-tool-chip-detail">{step.detail}</div>}
    </div>
  );
}
