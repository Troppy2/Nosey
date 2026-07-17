import { ChevronRight } from "lucide-react";
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

export function KojoReasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);

  useEffect(() => {
    if (live && !open) setOpen(true);
    if (wasLive.current && !live) setOpen(false); // collapse when thinking ends
    wasLive.current = live;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  if (!text && !live) return null;

  return (
    <div className={`kojo-reasoning${open ? " kojo-reasoning--open" : ""}`}>
      <button
        type="button"
        className="kojo-reasoning-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRight size={13} className="kojo-reasoning-chevron" aria-hidden="true" />
        <span className="kojo-reasoning-label">Reasoning</span>
        {live && <span className="kojo-reasoning-live">thinking</span>}
      </button>
      {open && (
        <div className="kojo-reasoning-body">
          <MarkdownContent content={text} />
          {live && <span className="kojo-caret" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
