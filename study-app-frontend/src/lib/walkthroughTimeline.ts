import type { KojoLecture, SolutionWalkthrough, WalkFrame } from "./types";

// Turns a Kojo video (a solution walkthrough or a pattern lecture) into a fixed
// timeline so it plays, scrubs and seeks like a video. Each segment is one spoken line
// plus the scene on screen while it is said. Durations are estimated from the text
// (speech pace) and typing time for code, or taken from the recorded clips.

export const CHAPTERS = ["Breakdown", "Approaches", "Drawing", "Code"] as const;
export const LECTURE_CHAPTERS = ["Theory", "Spot it", "Template", "Walkthrough"] as const;

export type CodeLine = { line: string; say: string };
export type Card = { title: string; badge?: string; tone?: string; pills?: string[]; body: string; detail?: string };

/** What the stage shows. Scenes are plain data so any video type can reuse them. */
export type Scene =
  | { type: "title"; kicker: string; title: string; points: string[]; from: number; to: number }
  | { type: "cards"; cards: Card[]; current: number }
  | { type: "ink"; frames: WalkFrame[]; current: number }
  | { type: "code"; label: string; lines: CodeLine[]; current: number; complexity?: { time: string; space: string } };

export type Segment = {
  chapter: number;
  say: string;
  start: number;
  dur: number;
  scene: Scene;
  /** Code segments: seconds to type the line. */
  typeDur?: number;
};

export type Timeline = { chapters: readonly string[]; segments: Segment[]; total: number };

const WORDS_PER_SECOND = 2.6;
const MIN_SPOKEN = 2.2;
const SECONDS_PER_CHAR = 0.035;

export function estimateSpeech(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(MIN_SPOKEN, words / WORDS_PER_SECOND + 0.4);
}

type Draft = Omit<Segment, "start">;

/** Builds drafts with durations from real clip lengths when known, else estimates. */
class Drafter {
  drafts: Draft[] = [];
  constructor(private spoken?: Map<string, number>) {}
  speech(text: string) {
    const real = this.spoken?.get(text.trim());
    return real !== undefined ? real + 0.35 : estimateSpeech(text);
  }
  add(chapter: number, say: string, scene: Scene, extra = 0, minDur = 0) {
    this.drafts.push({ chapter, say, scene, dur: Math.max(minDur, this.speech(say) + extra) });
  }
  ink(chapter: number, frames: WalkFrame[]) {
    frames.forEach((f, current) => {
      // Give the pen time to draw even when the line is short.
      const inkTime = 1.2 + f.strokes.length * 0.45 + f.labels.length * 0.25;
      this.add(chapter, f.say, { type: "ink", frames, current }, 0, inkTime);
    });
  }
  code(chapter: number, label: string, lines: CodeLine[]) {
    lines.forEach((c, current) => {
      const typeDur = Math.max(0.35, c.line.trim().length * SECONDS_PER_CHAR);
      this.drafts.push({
        chapter,
        say: c.say,
        scene: { type: "code", label, lines, current },
        typeDur,
        dur: Math.max(typeDur + 0.25, this.speech(c.say)),
      });
    });
  }
  done(chapters: readonly string[]): Timeline {
    let t = 0;
    const segments = this.drafts.map((d) => {
      const seg = { ...d, start: t };
      t += d.dur;
      return seg;
    });
    return { chapters, segments, total: t };
  }
}

/** Points revealed while line `step` of `count` lines plays (title cards). */
function reveal(step: number, count: number, points: number): [number, number] {
  const at = (s: number) => Math.ceil((s / Math.max(1, count)) * points);
  return [at(step), at(step + 1)];
}

export function buildTimeline(walk: SolutionWalkthrough, problemTitle: string, spoken?: Map<string, number>): Timeline {
  const d = new Drafter(spoken);
  const title = problemTitle || walk.title;
  const intro = `Let's solve ${title}.`;
  const titleScene = (from: number, to: number): Scene => ({ type: "title", kicker: "Kojo explains", title, points: walk.key_points, from, to });
  d.add(0, intro, titleScene(0, 0), 0.6);
  walk.breakdown.forEach((say, i) => d.add(0, say, titleScene(...reveal(i, walk.breakdown.length, walk.key_points.length))));
  const cards: Card[] = walk.approaches.map((a) => ({
    title: a.name,
    badge: a.verdict,
    tone: a.verdict.replace(" ", "-"),
    pills: [`Time ${a.time || "-"}`, `Space ${a.space || "-"}`],
    body: a.idea,
    detail: a.why,
  }));
  walk.approaches.forEach((a, current) => d.add(1, a.say || `${a.name}. ${a.idea} ${a.why}`, { type: "cards", cards, current }, 0.6));
  d.ink(2, walk.frames);
  d.code(3, "Solution code", walk.code);
  const cx = walk.complexity_say || `Time ${walk.time_complexity}, space ${walk.space_complexity}.`;
  d.add(3, cx, { type: "code", label: "Solution code", lines: walk.code, current: walk.code.length, complexity: { time: walk.time_complexity, space: walk.space_complexity } }, 1);
  return d.done(CHAPTERS);
}

export function buildLectureTimeline(lecture: KojoLecture, problemTitle: string, spoken?: Map<string, number>): Timeline {
  const d = new Drafter(spoken);
  const theoryPoints = lecture.theory.map((p) => p.point);
  const intro = `Let's learn ${lecture.title}.`;
  d.add(0, intro, { type: "title", kicker: "Kojo teaches", title: lecture.title, points: theoryPoints, from: 0, to: 0 }, 0.6);
  lecture.theory.forEach((p, i) =>
    d.add(0, p.say, { type: "title", kicker: "Kojo teaches", title: lecture.title, points: theoryPoints, from: i, to: i + 1 }),
  );
  d.ink(0, lecture.theory_frames);
  const cards: Card[] = lecture.signals.map((s) => ({ title: s.signal, badge: "signal", tone: "works", body: s.example ? `"${s.example}"` : "" }));
  lecture.signals.forEach((s, current) => d.add(1, s.say, { type: "cards", cards, current }, 0.4));
  d.code(2, "Template", lecture.template);
  const introPoints = lecture.problem_intro.map((p) => p.point);
  lecture.problem_intro.forEach((p, i) =>
    d.add(3, p.say, { type: "title", kicker: "Worked problem", title: problemTitle, points: introPoints, from: i, to: i + 1 }),
  );
  d.ink(3, lecture.frames);
  d.code(3, "Solution code", lecture.code);
  const cx = lecture.complexity_say || `Time ${lecture.time_complexity}, space ${lecture.space_complexity}.`;
  d.add(3, cx, { type: "code", label: "Solution code", lines: lecture.code, current: lecture.code.length, complexity: { time: lecture.time_complexity, space: lecture.space_complexity } }, 1);
  return d.done(LECTURE_CHAPTERS);
}

/** Every spoken line, in play order, without repeats: what Kojo records in one pass. */
export function spokenLines(timeline: Timeline): string[] {
  return [...new Set(timeline.segments.map((s) => s.say.trim()).filter(Boolean))];
}

/** Index of the segment playing at time t (last one at or past the end). */
export function segmentAt(segments: Segment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function chapterStart(segments: Segment[], chapter: number): number | null {
  const seg = segments.find((s) => s.chapter === chapter);
  return seg ? seg.start : null;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
