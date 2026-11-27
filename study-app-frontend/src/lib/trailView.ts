// View models for the Pattern Trails pages: turn API data into what each stop,
// land and card shows. Pure, so the copy and the rules are unit tested.
import { TAXONOMY_PROBLEMS } from "../data/leetcodeTaxonomy";
import type { PTGateState, PTMap, PTPath, PTRedo, PTSubtopicSummary, PTTopicSummary } from "./types";

export type StopState = "done" | "current" | "open" | "locked";

export type PathStop = {
  key: string;
  kind: "lesson" | "step" | "yarn";
  /** Short label on the signpost ("Kojo lesson", "3. Min window"). */
  short: string;
  /** Second signpost line ("Watched", "+1 solved", "Kojo is here", "Locked"). */
  status: string;
  /** Quest card title. */
  title: string;
  /** Quest card body. */
  detail: string;
  state: StopState;
  stepId: number | null;
  problemSlug: string | null;
  difficulty: string | null;
  lockedReason: string | null;
  /** A waiting or due redo next to this stop (wilted flower / bloom). */
  redo: { due: boolean; label: string } | null;
};

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

/** The problem title from the catalog; a readable fallback from the slug. */
export function problemTitle(slug: string): string {
  const hit = TAXONOMY_PROBLEMS.find((p) => p.slug === slug);
  if (hit) return hit.title;
  return slug
    .split("-")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** A short signpost label: the first words of the title, never cut mid-word. */
export function shortTitle(title: string, max = 18): string {
  if (title.length <= max) return title;
  const words = title.split(" ");
  let out = "";
  for (const w of words) {
    if ((out ? out.length + 1 : 0) + w.length > max) break;
    out = out ? `${out} ${w}` : w;
  }
  return out || title.slice(0, max);
}

export function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/** "today", "tomorrow", "in 6 days" from now to `iso` (calendar days, local time). */
export function dueIn(iso: string, now: Date = new Date()): string {
  const due = new Date(iso);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(due) - day(now)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function redoBadge(redo: PTRedo | null, now: Date): PathStop["redo"] {
  if (!redo) return null;
  if (redo.due) return { due: true, label: "Redo due" };
  return { due: false, label: `Redo ${dueIn(redo.due_at, now)}` };
}

/** Lesson, five steps, yarn: what each stop of a path shows. */
export function pathStops(path: PTPath, now: Date = new Date()): PathStop[] {
  const watched = path.lesson.watched;
  const hasVideo = Boolean(path.lesson.lecture_slug);
  const lesson: PathStop = {
    key: "lesson",
    kind: "lesson",
    short: "Kojo lesson",
    status: watched ? "Watched" : "Start here",
    title: `Kojo lesson: ${path.title}`,
    detail: watched
      ? `You have the cues for ${path.title.toLowerCase()}. Open it again any time.`
      : hasVideo
        ? "Watch Kojo explain the cues and the template. Step 1 opens when the video ends."
        : "Read Kojo's notes on the cues and the template. Step 1 opens when you finish them.",
    state: watched ? "done" : "current",
    stepId: null,
    problemSlug: null,
    difficulty: null,
    lockedReason: null,
    redo: null,
  };
  if (!path.open) {
    // The whole path waits on the one before it.
    lesson.state = "locked";
    lesson.status = "Locked";
    lesson.lockedReason = path.locked_reason ?? "Finish the path before this one first";
    lesson.detail = `${lesson.lockedReason}.`;
  }
  const steps: PathStop[] = path.steps.map((s) => {
    const title = problemTitle(s.problem_slug);
    const limit = formatMinutes(s.time_limit_s);
    const state: StopState = s.state === "passed" ? "done" : s.state === "open" ? "current" : "locked";
    let detail: string;
    if (s.state === "passed") {
      detail = s.best_seconds
        ? `${s.difficulty}. Passed in ${formatMinutes(s.best_seconds)}.`
        : `${s.difficulty}. Passed.`;
    } else if (s.state === "open") {
      detail = `${s.difficulty}. Pass every test inside ${limit}, then explain your code to Kojo: approach, how it works, complexity and your thinking.`;
      if (s.attempts > 0) detail += ` ${s.attempts === 1 ? "One try" : `${s.attempts} tries`} so far.`;
    } else {
      detail = `${s.difficulty}. ${s.locked_reason ?? "Locked"}.`;
    }
    return {
      key: `step-${s.id}`,
      kind: "step",
      short: `${s.position}. ${title}`,
      status: state === "done" ? "+1 solved" : state === "current" ? "Kojo is here" : "Locked",
      title: `Step ${s.position}: ${title}`,
      detail,
      state,
      stepId: s.id,
      problemSlug: s.problem_slug,
      difficulty: s.difficulty,
      lockedReason: s.state === "locked" ? s.locked_reason : null,
      redo: redoBadge(s.redo, now),
    };
  });
  const yarn: PathStop = {
    key: "yarn",
    kind: "yarn",
    short: "The yarn",
    status: path.finished ? "Caught" : "Finish line",
    title: path.finished ? "Path finished" : "The yarn",
    detail: path.finished
      ? path.next_subtopic_slug
        ? "Kojo caught the yarn. The next path is open on the map."
        : "Kojo caught the yarn. Every path here is done, so the topic gate is open on the map."
      : `Pass all ${path.steps.length} steps and Kojo catches the yarn.`,
    state: path.finished ? "done" : "locked",
    stepId: null,
    problemSlug: null,
    difficulty: null,
    lockedReason: path.finished ? null : `Pass step ${path.steps.length} first`,
    redo: null,
  };
  return [lesson, ...steps, yarn];
}

/** The stop Kojo stands on: the lesson until watched, then the open step, the yarn when done. */
export function kojoIndex(path: PTPath): number {
  if (!path.lesson.watched) return 0;
  if (path.finished) return path.steps.length + 1;
  const open = path.steps.findIndex((s) => s.state === "open");
  return open >= 0 ? open + 1 : path.steps.filter((s) => s.state === "passed").length + 1;
}

/** "72%" or a dash when there is nothing to measure yet. */
export function percent(rate: number | null): string {
  return rate == null ? "-" : `${Math.round(rate * 100)}%`;
}

/** One line under a path's name on the map. */
export function subtopicStatus(sub: PTSubtopicSummary, index: number, subs: PTSubtopicSummary[]): string {
  if (sub.finished) return "Path finished";
  if (!sub.open) return `Opens after ${subs[index - 1]?.title ?? "the path above"}`;
  if (!sub.lesson_watched) return "Start with Kojo's lesson";
  if (sub.passed_count === 0) return "Kojo is at step 1";
  return `Kojo is at step ${Math.min(sub.passed_count + 1, sub.step_states.length)} of ${sub.step_states.length}`;
}

/** The gate row's state line. */
export function gateStatus(gate: PTGateState, now: Date = new Date()): string {
  if (gate.cleared) return `Cleared${gate.best_correct != null ? `, ${gate.best_correct} of ${gate.size} picked right` : ""}`;
  if (gate.state === "locked") return "Opens after every path here";
  if (gate.state === "cooldown" && gate.locked_until) {
    const ms = new Date(gate.locked_until).getTime() - now.getTime();
    const hours = Math.max(1, Math.ceil(ms / 3_600_000));
    return `Opens again in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (gate.state === "in_progress") return "In progress";
  return `${gate.size} unlabeled problems mixed with patterns you know`;
}

/** Share of a topic's steps passed, 0..1, for the land's progress ring. */
export function topicProgress(topic: PTTopicSummary): number {
  const total = topic.subtopics.reduce((n, s) => n + s.step_states.length, 0);
  const passed = topic.subtopics.reduce((n, s) => n + s.passed_count, 0);
  return total ? passed / total : 0;
}

/** Which land opens selected: the one Kojo is on, else the first. */
export function initialTopic(map: PTMap): string | null {
  return map.current_topic_slug ?? map.topics[0]?.slug ?? null;
}


/** Router state the editor (trail mode, WP6) hands back so the path plays the walk. */
export type TrailWalkState = {
  /** Stop index Kojo walked to (1..5 for steps). */
  walkedTo: number;
  solvedDelta: number;
  slow: boolean;
  /** A redo was scheduled (failed or slow pass). */
  redoDueAt: string | null;
};

export function readWalkState(state: unknown): TrailWalkState | null {
  if (!state || typeof state !== "object") return null;
  const walk = (state as { trailWalk?: unknown }).trailWalk;
  if (!walk || typeof walk !== "object") return null;
  const w = walk as Record<string, unknown>;
  if (typeof w.walkedTo !== "number" || !Number.isInteger(w.walkedTo) || w.walkedTo < 1) return null;
  return {
    walkedTo: w.walkedTo,
    solvedDelta: typeof w.solvedDelta === "number" ? w.solvedDelta : 0,
    slow: w.slow === true,
    redoDueAt: typeof w.redoDueAt === "string" ? w.redoDueAt : null,
  };
}

/** The editor URL for a trail step (WP6 reads `trailStep`). */
export function stepEditorUrl(problemSlug: string, stepId: number, pathSlug?: string): string {
  const back = pathSlug ? `&trailPath=${encodeURIComponent(pathSlug)}` : "";
  return `/leetcode?problem=${encodeURIComponent(problemSlug)}&trailStep=${stepId}${back}`;
}

/** The editor URL that runs due redos back to back, first one first (WP6 reads `trailRedos`). */
export function redoRunUrl(redos: PTRedo[]): string | null {
  if (!redos.length) return null;
  const ids = redos.map((r) => r.id).join(",");
  return `/leetcode?problem=${encodeURIComponent(redos[0].problem_slug)}&trailRedos=${ids}`;
}
