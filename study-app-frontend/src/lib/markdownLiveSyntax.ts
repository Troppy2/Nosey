// Markdown syntax for the live-preview answer editor (MarkdownLiveEditor): the
// GFM pieces Obsidian uses plus ==highlight==, which plain markdown lacks.
import type { MarkdownConfig } from "@lezer/markdown";
import { Strikethrough, Table, TaskList } from "@lezer/markdown";

const EQUALS = 61;
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

export const Highlight: MarkdownConfig = {
  defineNodes: ["Highlight", "HighlightMark"],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, /\S/.test(after), /\S/.test(before));
      },
      after: "Emphasis",
    },
  ],
};

export const LIVE_MARKDOWN_EXTENSIONS = [Strikethrough, Table, TaskList, Highlight];

// Obsidian callout types grouped onto the app's semantic accents (same grouping
// as MarkdownContent's rendered callouts).
const CALLOUT_TONE: Record<string, string> = {
  note: "info", info: "info", todo: "info", abstract: "neutral", summary: "neutral", tldr: "neutral",
  tip: "positive", hint: "positive", important: "positive", success: "positive", check: "positive", done: "positive",
  question: "caution", help: "caution", faq: "caution", warning: "caution", caution: "caution", attention: "caution",
  failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger",
  example: "neutral", quote: "neutral", cite: "neutral",
};

export function calloutTone(type: string): string {
  return CALLOUT_TONE[type.toLowerCase()] ?? "info";
}

// "[!tip]+ Title" at the start of a quote's first line (after "> ").
export const CALLOUT_HEAD_RE = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*/;

// Inline / single-line display math on one line: $x$ or $$x$$. Real inline
// math is tight or evenly padded ("$5 and $2" is two prices, not math).
const MATH_RE = /\$\$([^$\n]+?)\$\$|(?<![\\$])\$([^$\n]+?)\$(?!\$)/g;

export type MathSpan = { from: number; to: number; src: string; display: boolean };

export function findInlineMath(line: string, offset: number): MathSpan[] {
  const out: MathSpan[] = [];
  MATH_RE.lastIndex = 0;
  for (let m = MATH_RE.exec(line); m !== null; m = MATH_RE.exec(line)) {
    const display = m[1] !== undefined;
    const body = display ? m[1] : m[2];
    if (!body.trim()) continue;
    if (!display && /^\s/.test(body) !== /\s$/.test(body)) continue;
    out.push({ from: offset + m.index, to: offset + m.index + m[0].length, src: body.trim(), display });
  }
  return out;
}
