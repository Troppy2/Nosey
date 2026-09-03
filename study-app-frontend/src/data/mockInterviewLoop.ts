import {
  CheckCircle2,
  Code2,
  FileText,
  MessageSquare,
  Minus,
  ScrollText,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * The vocabulary of a mock interview loop: the stages, their time budgets, and the
 * two verdict ladders the backend grades against. This is data, not rendering, so it
 * lives here rather than in the rail component that draws it. `lib/` and the pages
 * can read the stage order without pulling React components into their import graph.
 *
 * The rail itself is `components/MockLoopRail.tsx`.
 */

export type LoopStageKey = "resume" | "stage1" | "stage2" | "stage3";

export type LoopStage = {
  key: LoopStageKey;
  /** Full name, used on the setup spine and the debrief. */
  label: string;
  /** Two words at most, used in the flattened track. */
  short: string;
  /** The time budget the app actually enforces or allows for this stage. */
  minutes: number;
  /** The field this stage's verdict arrives in on the finish response. */
  verdictKey: "resume_verdict" | "stage1_verdict" | "stage2_verdict" | "stage3_verdict";
  icon: LucideIcon;
  description: string;
};

export const LOOP_STAGES: LoopStage[] = [
  {
    key: "resume",
    label: "Resume screen",
    short: "Resume",
    minutes: 2,
    verdictKey: "resume_verdict",
    icon: FileText,
    description: "An ATS pass on your resume. It tells you whether you would earn the OA, and never blocks you.",
  },
  {
    key: "stage1",
    label: "Online assessment",
    short: "OA",
    minutes: 90,
    verdictKey: "stage1_verdict",
    icon: Code2,
    description: "Two to three problems in a real in-app editor, each on its own clock. No hints.",
  },
  {
    key: "stage2",
    label: "Technical interview",
    short: "Technical",
    minutes: 45,
    verdictKey: "stage2_verdict",
    icon: Users,
    description: "A live conversation: your background, CS questions, then one coding challenge.",
  },
  {
    key: "stage3",
    label: "Behavioral interview",
    short: "Behavioral",
    minutes: 45,
    verdictKey: "stage3_verdict",
    icon: MessageSquare,
    description: "STAR questions written for this company. Say the answer out loud, then type it.",
  },
];

/** Every stage, in loop order. The default when a page has no better answer. */
export const ALL_STAGE_KEYS: LoopStageKey[] = LOOP_STAGES.map((s) => s.key);

/** The loop always ends here, so the debrief is a station you cannot switch off. */
export const DEBRIEF_STATION = {
  label: "Debrief",
  short: "Debrief",
  icon: ScrollText,
  description: "A recruiter-style writeup: a verdict on every stage you ran, and one hiring call.",
};

export function totalLoopMinutes(selected: string[]): number {
  return LOOP_STAGES.reduce((sum, s) => (selected.includes(s.key) ? sum + s.minutes : sum), 0);
}

/** Schedule formatting: "45 min" under an hour, "3h 02m" above it. */
export function formatLoopDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * Per-stage verdicts. `className` doubles as the badge fill (see `.verdict-*` in
 * styles.css) and `color` is for the few places a verdict tints an icon inline.
 * Keep the two in step: the hexes here mirror those rules.
 */
export const VERDICT_META: Record<
  string,
  { label: string; className: string; icon: LucideIcon; color: string }
> = {
  strong: { label: "Strong Pass", className: "verdict-strong", icon: CheckCircle2, color: "#10b981" },
  pass: { label: "Pass", className: "verdict-pass", icon: CheckCircle2, color: "#3b82f6" },
  borderline: { label: "Borderline", className: "verdict-borderline", icon: Minus, color: "#f59e0b" },
  needs_work: { label: "Needs Work", className: "verdict-needs-work", icon: XCircle, color: "#ef4444" },
};

export function verdictMeta(verdict?: string | null) {
  return VERDICT_META[verdict ?? ""] ?? VERDICT_META.borderline;
}

/**
 * The overall hiring call. Longest label first so "STRONG HIRE" is not swallowed by
 * the "HIRE" check when scanning free text. This ladder mirrors the backend's
 * `_extract_recommendation` in `routes/mock_interview.py`; there is no codegen step,
 * so if the backend ladder changes, change it here too.
 */
export const RECOMMENDATIONS = ["STRONG HIRE", "NO HIRE", "BORDERLINE", "HIRE"] as const;

export const RECOMMENDATION_META: Record<
  string,
  { label: string; className: string; icon: LucideIcon; description: string }
> = {
  "STRONG HIRE": {
    label: "Strong Hire",
    className: "rec-strong-hire",
    icon: CheckCircle2,
    description: "Exceptional performance across all stages.",
  },
  HIRE: {
    label: "Hire",
    className: "rec-hire",
    icon: CheckCircle2,
    description: "Solid performance. Ready for the role.",
  },
  BORDERLINE: {
    label: "Borderline",
    className: "rec-borderline",
    icon: Minus,
    description: "Mixed performance. More practice needed.",
  },
  "NO HIRE": {
    label: "No Hire",
    className: "rec-no-hire",
    icon: XCircle,
    description: "Significant gaps identified. Keep practicing.",
  },
};

export function recommendationMeta(recommendation?: string | null) {
  return RECOMMENDATION_META[recommendation ?? ""] ?? RECOMMENDATION_META.BORDERLINE;
}
