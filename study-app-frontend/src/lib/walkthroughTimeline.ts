import type { SolutionWalkthrough } from "./types";

// Turns Kojo's walkthrough script into a fixed timeline so it plays, scrubs and seeks
// like a video. Each segment is one spoken line plus what appears on screen while it
// is said. Durations are estimated from the text (speech pace) and from typing time
// for code; the player holds a segment open if the voice runs longer than that.

export const CHAPTERS = ["Breakdown", "Approaches", "Drawing", "Code"] as const;
export type ChapterIndex = 0 | 1 | 2 | 3;

export type Segment =
  | { kind: "intro"; chapter: 0; say: string; start: number; dur: number }
  | { kind: "breakdown"; chapter: 0; index: number; say: string; start: number; dur: number }
  | { kind: "approach"; chapter: 1; index: number; say: string; start: number; dur: number }
  | { kind: "frame"; chapter: 2; index: number; say: string; start: number; dur: number }
  | { kind: "code"; chapter: 3; index: number; say: string; start: number; dur: number; typeDur: number }
  | { kind: "complexity"; chapter: 3; say: string; start: number; dur: number };

const WORDS_PER_SECOND = 2.6;
const MIN_SPOKEN = 2.2;
const SECONDS_PER_CHAR = 0.035;

export function estimateSpeech(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(MIN_SPOKEN, words / WORDS_PER_SECOND + 0.4);
}

// Distributive omit: plain Omit on a union keeps only the shared keys (drops `index`).
type Draft = Segment extends infer S ? (S extends Segment ? Omit<S, "start"> : never) : never;

/** Every spoken line, in play order, without repeats: what Kojo records in one pass. */
export function spokenLines(walk: SolutionWalkthrough, problemTitle: string): string[] {
  const { segments } = buildTimeline(walk, problemTitle);
  return [...new Set(segments.map((s) => s.say.trim()).filter(Boolean))];
}

/**
 * `spoken` maps a line to the real length of Kojo's recorded clip, in seconds. With it
 * the timeline matches the audio exactly; without it (browser voice) it is estimated.
 */
export function buildTimeline(
  walk: SolutionWalkthrough,
  problemTitle: string,
  spoken?: Map<string, number>,
): { segments: Segment[]; total: number } {
  const speechSeconds = (text: string) => {
    const real = spoken?.get(text.trim());
    return real !== undefined ? real + 0.35 : estimateSpeech(text);
  };
  const drafts: Draft[] = [];
  const intro = `Let's solve ${problemTitle || walk.title}.`;
  drafts.push({ kind: "intro", chapter: 0, say: intro, dur: speechSeconds(intro) + 0.6 });
  walk.breakdown.forEach((say, index) => drafts.push({ kind: "breakdown", chapter: 0, index, say, dur: speechSeconds(say) }));
  walk.approaches.forEach((a, index) => {
    const say = a.say || `${a.name}. ${a.idea} ${a.why}`;
    drafts.push({ kind: "approach", chapter: 1, index, say, dur: speechSeconds(say) + 0.6 });
  });
  walk.frames.forEach((f, index) => {
    // Give the pen time to draw even when the line is short.
    const inkTime = 1.2 + f.strokes.length * 0.45 + f.labels.length * 0.25;
    drafts.push({ kind: "frame", chapter: 2, index, say: f.say, dur: Math.max(speechSeconds(f.say), inkTime) });
  });
  walk.code.forEach((c, index) => {
    const typeDur = Math.max(0.35, c.line.trim().length * SECONDS_PER_CHAR);
    drafts.push({ kind: "code", chapter: 3, index, say: c.say, typeDur, dur: Math.max(typeDur + 0.25, speechSeconds(c.say)) });
  });
  const cx = walk.complexity_say || `Time ${walk.time_complexity}, space ${walk.space_complexity}.`;
  drafts.push({ kind: "complexity", chapter: 3, say: cx, dur: speechSeconds(cx) + 1 });

  let t = 0;
  const segments = drafts.map((d) => {
    const seg = { ...d, start: t } as Segment;
    t += d.dur;
    return seg;
  });
  return { segments, total: t };
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

export function chapterStart(segments: Segment[], chapter: ChapterIndex): number | null {
  const seg = segments.find((s) => s.chapter === chapter);
  return seg ? seg.start : null;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
