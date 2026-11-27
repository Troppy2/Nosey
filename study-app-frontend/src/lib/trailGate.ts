// View helpers for the topic gate page (pages/PatternTrailGate.tsx). Pure, so the
// flow and the copy are unit tested. The problem slug never appears here: gate items
// are addressed by attempt id + item id only.
import type { PTGateAttempt, PTGateItem } from "./types";

/** Shortest reason the page accepts. The server takes 1..200; a few words keep it honest. */
export const REASON_MIN = 8;
export const REASON_MAX = 200;

export function gateUrl(topicSlug: string, attemptId?: number | null): string {
  const base = `/pattern-trails/gate/${encodeURIComponent(topicSlug)}`;
  return attemptId ? `${base}?attempt=${attemptId}` : base;
}

/** The editor in gate context (WP6 reads `trailGate` / `gateItem`). No slug, no title. */
export function gateEditorUrl(attemptId: number, itemId: number, topicSlug: string): string {
  return `/leetcode?trailGate=${attemptId}&gateItem=${itemId}&gateTopic=${encodeURIComponent(topicSlug)}`;
}

export type GateTurn = { item: PTGateItem; phase: "pick" | "solve" };

/** Where the user is: the first item still to pick, or picked but not solved yet.
 * Items run in order, so a picked-but-unsolved item comes before the next pick.
 * Null when every item is picked and solved (the end screen). */
export function currentTurn(attempt: PTGateAttempt): GateTurn | null {
  const items = [...attempt.items].sort((a, b) => a.position - b.position);
  for (const item of items) {
    if (item.picked_key == null) return { item, phase: "pick" };
    if (item.solved == null) return { item, phase: "solve" };
  }
  return null;
}

/** "Problem 2 of 5". */
export function problemLabel(item: PTGateItem, attempt: PTGateAttempt): string {
  return `Problem ${item.position} of ${attempt.items.length}`;
}

/** "No picks yet, need 4 right", "2 right so far, need 4", "4 right, gate cleared". */
export function progressLine(attempt: PTGateAttempt): string {
  const right = attempt.correct_count;
  const left = attempt.items.length - attempt.picks_made;
  if (attempt.passed === true) return `${right} right, gate cleared`;
  if (attempt.passed === false) return `${right} right, needed ${attempt.need}`;
  if (attempt.picks_made === 0) return `No picks yet, need ${attempt.need} right`;
  if (right + left < attempt.need) return `${right} right so far, the gate cannot pass this time`;
  if (right >= attempt.need) return `${right} right, enough to pass`;
  return `${right} right so far, need ${attempt.need}`;
}

export type ReasonCheck = { ok: boolean; hint: string };

/** The hint under the reason field: why the button is off, then a counter. */
export function reasonCheck(reason: string): ReasonCheck {
  const text = reason.trim();
  if (text.length < REASON_MIN) return { ok: false, hint: "Write a few words on why" };
  return { ok: true, hint: `${text.length} of ${REASON_MAX}` };
}

/** "Opens again in 23 hours" (at least 1 hour, rounded up). */
export function reopensIn(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Opens again in 24 hours";
  const hours = Math.max(1, Math.ceil((new Date(iso).getTime() - now.getTime()) / 3_600_000));
  return `Opens again in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** The pattern a pick key names, from the attempt's options. */
export function patternTitle(attempt: PTGateAttempt, key: string | null): string {
  if (!key) return "";
  return attempt.options.find((o) => o.key === key)?.title ?? key;
}

/** "Solved in 12 minutes", "Not solved, it comes back as a redo". */
export function solveLine(item: PTGateItem): string | null {
  if (item.solved == null) return null;
  if (!item.solved) return "Not solved, it comes back as a redo";
  const minutes = Math.max(1, Math.round((item.seconds ?? 0) / 60));
  return `Solved in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** Plain-text override statements: paragraphs split on blank lines. */
export function statementParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** LeetCode follow-ups often name the technique ("Could you do it with a sliding
 * window?"). Drop the follow-up block and everything after it. Parses into an inert
 * document (nothing runs); sanitize the result before rendering. */
export function withoutFollowUp(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return html;
  // Usually a top-level <p>, sometimes inside a wrapper div.
  const isFollowUp = (el: Element) => /^\s*follow[\s-]*up\b/i.test(el.textContent ?? "");
  const start = Array.from(root.querySelectorAll("p")).find(isFollowUp) ?? Array.from(root.children).find(isFollowUp);
  if (!start) return html;
  let node: ChildNode | null = start;
  while (node) {
    const next: ChildNode | null = node.nextSibling;
    node.remove();
    node = next;
  }
  return root.innerHTML;
}

export type GateSolveHandBack = { itemId: number; solved: boolean; slow: boolean; redoDueAt: string | null };

/** Router state the editor sends back after a gate solve (WP6):
 * `{ gateSolve: { itemId, solved, slow, redoDueAt } }`. */
export function readGateSolve(state: unknown): GateSolveHandBack | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as { gateSolve?: unknown }).gateSolve;
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.itemId !== "number" || typeof s.solved !== "boolean") return null;
  return {
    itemId: s.itemId,
    solved: s.solved,
    slow: s.slow === true,
    redoDueAt: typeof s.redoDueAt === "string" ? s.redoDueAt : null,
  };
}
