/**
 * Dev-only page for Playwright MCP visual review. Mount at e.g. /__icons.
 * - Rows at 16/20/24px, outline and filled, light and dark, icons side by side
 * - 96px outline + filled with 24-grid overlay
 * - Optional Lucide equivalent next to each icon for the not-Lucide check
 *
 * Playwright: hover `[data-icon="BellIcon"]` for the nudge; click it to toggle filled.
 */
import { useState, type ComponentType } from "react";
import * as Icons from ".";
import "./icons.css";
import * as LucideIcons from "lucide-react";

// Optional: map your icon → Lucide name. Requires lucide-react installed.
// import * as Lucide from "lucide-react";
const LUCIDE: Record<string, string> = {
  TestsTakenIcon: "ClipboardList",
  ScoreRiseIcon: "TrendingUp",
  CrownIcon: "Crown",
  SproutIcon: "Sprout",
  CloseIcon: "X",
  CheckIcon: "Check",
  CheckCircleIcon: "CheckCircle2",
  CrossCircleIcon: "XCircle",
  AlertIcon: "AlertCircle",
  InfoIcon: "Info",
  PlusIcon: "Plus",
  TrashIcon: "Trash2",
  SearchIcon: "Search",
  CopyIcon: "Copy",
  UploadIcon: "Upload",
  SparklesIcon: "Sparkles",
  PencilIcon: "Pencil",
  RetryIcon: "RotateCcw",
  ChevronRightIcon: "ChevronRight",
  ArrowRightIcon: "ArrowRight",
};
const Lucide = LucideIcons as unknown as Record<string, ComponentType<{ size?: number }>>;

type IconComp = ComponentType<{ size?: number; active?: boolean }>;
const entries = Object.entries(Icons).filter(
  ([k, v]) => k.endsWith("Icon") && k !== "Icon" && (typeof v === "object" || typeof v === "function")
) as [string, IconComp][];

function GridOverlay() {
  const lines = [];
  for (let i = 0; i <= 24; i++) {
    lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={24} />);
    lines.push(<line key={`h${i}`} x1={0} y1={i} x2={24} y2={i} />);
  }
  return (
    <svg viewBox="0 0 24 24" width={96} height={96}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <g stroke="rgba(255,0,80,.18)" strokeWidth={0.05}>{lines}</g>
      <rect x={2} y={2} width={20} height={20} fill="none" stroke="rgba(0,160,255,.6)" strokeWidth={0.08} />
      <rect x={2} y={4} width={20} height={16} rx={4} fill="none" stroke="rgba(0,160,255,.35)" strokeWidth={0.08} />
    </svg>
  );
}

function Row({ size, active }: { size: number; active: boolean }) {
  return (
    <div data-row={`${active ? "filled" : "outline"}-${size}`}
      style={{ display: "flex", gap: size, alignItems: "center", marginBottom: 12 }}>
      <code style={{ width: 72, fontSize: 11, opacity: 0.6 }}>{size}px {active ? "fill" : "line"}</code>
      {entries.map(([name, C]) => <C key={name} size={size} active={active} />)}
    </div>
  );
}

function Panel({ dark }: { dark: boolean }) {
  const [pressed, setPressed] = useState<Record<string, boolean>>({});
  return (
    <section data-theme={dark ? "dark" : "light"}
      style={{ background: dark ? "#111214" : "#fafaf9", color: dark ? "#e8e8e6" : "#1c1c1e", padding: 24 }}>
      {[12, 16, 20, 24].map((s) => <Row key={`o${s}`} size={s} active={false} />)}
      {[12, 16, 20, 24].map((s) => <Row key={`f${s}`} size={s} active />)}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 32, marginTop: 24 }}>
        {entries.map(([name, C]) => {
          const L = Lucide && LUCIDE[name] ? Lucide[LUCIDE[name]] : null;
          return (
            <figure key={name} style={{ margin: 0, display: "flex", gap: 8, alignItems: "flex-end" }}>
              {L && (
                <div style={{ textAlign: "center", opacity: 0.8 }}>
                  <L size={96} /><div style={{ fontSize: 10 }}>lucide</div>
                </div>
              )}
              {[false, true].map((fixedActive) => (
                <div key={String(fixedActive)} style={{ textAlign: "center" }}>
                  <div style={{ position: "relative", width: 96, height: 96 }}>
                    <C size={96} active={fixedActive} /><GridOverlay />
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.6 }}>{fixedActive ? "filled" : "outline"}</div>
                </div>
              ))}
              <div style={{ textAlign: "center" }}>
                <button
                  data-icon={name}
                  aria-pressed={!!pressed[name]}
                  onClick={() => setPressed((p) => ({ ...p, [name]: !p[name] }))}
                  style={{ width: 96, height: 96, padding: 0, border: 0, background: "transparent",
                    color: "inherit", cursor: "pointer" }}
                >
                  <C size={96} />
                </button>
                <figcaption style={{ fontSize: 10, opacity: 0.6 }}>{name} (interactive)</figcaption>
              </div>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

export default function IconReviewSheet() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif" }}>
      <Panel dark={false} />
      <Panel dark />
    </main>
  );
}
