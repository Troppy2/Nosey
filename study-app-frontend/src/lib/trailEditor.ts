// Editor trail mode (pages/LeetCodeMode.tsx): which trail run the URL asks for.
// Steps: /leetcode?problem=<slug>&trailStep=<id>[&trailPath=<subtopic>]
// Redos: /leetcode?problem=<first slug>&trailRedos=<id,id,...>
export type TrailRun =
  | { kind: "step"; stepId: number; slug: string; pathSlug: string | null }
  | { kind: "redo"; ids: number[]; slug: string };

export function readTrailRun(search: string): TrailRun | null {
  const q = new URLSearchParams(search);
  const slug = q.get("problem");
  if (!slug) return null;
  const step = Number(q.get("trailStep"));
  if (Number.isInteger(step) && step > 0) return { kind: "step", stepId: step, slug, pathSlug: q.get("trailPath") };
  const ids = (q.get("trailRedos") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length) return { kind: "redo", ids, slug };
  return null;
}

/** Default time limits by difficulty (spec section 4), in seconds. */
export function trailLimit(difficulty: string | undefined): number {
  const d = (difficulty ?? "").toLowerCase();
  return d === "easy" ? 15 * 60 : d === "hard" ? 40 * 60 : 25 * 60;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
