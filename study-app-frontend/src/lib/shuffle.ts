// Display-order shuffling for the learning module quiz.
//
// The quiz is never reordered on the server: grading, correct_indices and
// option_explanations are all canonical (the order the questions were
// generated in). These helpers produce permutations the page renders through,
// so a retry cannot be passed by remembering that the answers were C, B, A, D.

// Fisher-Yates over a copy. Never mutates the input.
export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Options whose text refers to the position of other options. Moving one of
// these turns a valid question into a broken one ("All of the above" sitting
// second), so they are pinned to the tail instead of shuffled.
const POSITIONAL_PATTERNS = [
  /\b(all|none|both|any|either|neither)\s+of\s+(the\s+)?(above|these|the\s+others?)\b/i,
  /\b(all|none)\s+of\s+the\s+below\b/i,
  /\bboth\s+[a-f]\s+and\s+[a-f]\b/i,
  /^\s*[a-f]\s*(,|and|&|\+)\s*[a-f]\s*(\s*(,|and|&|\+)\s*[a-f])*\s*$/i,
  /^\s*(all|none)\s+(of\s+)?(the\s+)?(above|these)\s*$/i,
  /\ball\s+answers?\s+(are\s+)?correct\b/i,
  /\bnone\s+(of\s+these\s+)?(are|is)\s+correct\b/i,
];

export function isPositionalOption(text: string): boolean {
  return POSITIONAL_PATTERNS.some((pattern) => pattern.test(text));
}

// A permutation of option indices: positional options held at the end in their
// original relative order, everything else shuffled around them.
export function shuffledOptionOrder(options: string[]): number[] {
  const free: number[] = [];
  const pinned: number[] = [];
  options.forEach((option, index) => {
    (isPositionalOption(option) ? pinned : free).push(index);
  });
  return [...shuffled(free), ...pinned];
}

// True when `order` is a genuine permutation of 0..length-1. Used to reject a
// persisted order that no longer matches the quiz (the lesson was edited and
// the quiz regenerated) or that was hand-edited in localStorage.
export function isPermutationOf(order: unknown, length: number): order is number[] {
  if (!Array.isArray(order) || order.length !== length) return false;
  const seen = new Set<number>();
  for (const value of order) {
    if (!Number.isInteger(value) || value < 0 || value >= length) return false;
    if (seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}
