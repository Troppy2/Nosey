// GH #173. The backend marks a response with X-Nosey-Safety when moderation
// acted on what the user typed: "self-harm" (the request still succeeded,
// show support resources), "warning" (the request was refused),
// "warning-allowed" (a submission went through, e.g. test answers, but broke
// the rules), "suspended" (the account is banned). guardedFetch reports every one here, so no page
// has to handle it, and SafetyModal shows the matching modal.

export type SafetyKind = "self-harm" | "warning" | "warning-allowed" | "suspended";
const KINDS: ReadonlySet<string> = new Set(["self-harm", "warning", "warning-allowed", "suspended"]);

export const SAFETY_HEADER = "X-Nosey-Safety";
const EVENT = "nosey:safety";

export function reportSafety(kind: string | null): void {
  if (!kind || !KINDS.has(kind)) return;
  window.dispatchEvent(new CustomEvent<SafetyKind>(EVENT, { detail: kind as SafetyKind }));
}

export function onSafety(listener: (kind: SafetyKind) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<SafetyKind>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
