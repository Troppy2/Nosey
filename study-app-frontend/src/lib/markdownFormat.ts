// Format commands for the markdown answer editor (MarkdownLiveEditor): wrap the
// selection in markdown, or unwrap it when it is already wrapped. Code and math
// pick their block form for a multi-line selection.
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

export type FormatKind = "bold" | "italic" | "highlight" | "strike" | "code" | "math";

const INLINE: Record<FormatKind, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  highlight: ["==", "=="],
  strike: ["~~", "~~"],
  code: ["`", "`"],
  math: ["$", "$"],
};

const BLOCK: Partial<Record<FormatKind, [string, string]>> = {
  code: ["```\n", "\n```"],
  math: ["$$\n", "\n$$"],
};

function delimitersFor(kind: FormatKind, text: string): [string, string] {
  return text.includes("\n") ? (BLOCK[kind] ?? INLINE[kind]) : INLINE[kind];
}

// "*" must not unwrap the inside of "**bold**": italic only counts as wrapped
// when the star run is odd-length on that side.
function isWrappedBy(text: string, open: string, close: string, kind: FormatKind): boolean {
  if (text.length < open.length + close.length || !text.startsWith(open) || !text.endsWith(close)) return false;
  if (kind === "italic") return !text.startsWith("**") || text.startsWith("***");
  return true;
}

// Leading markdown a line keeps outside an inline format: quote markers, list
// bullets, task boxes, numbers and heading hashes.
const LINE_PREFIX_RE = /^(\s*(?:>\s?)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)?)/;

// An inline format over several lines wraps each line's content on its own, so
// "==" never spans a line break (which markdown would not render).
function wrapEachLine(text: string, open: string, close: string): string {
  return text
    .split("\n")
    .map((line) => {
      const prefix = line.match(LINE_PREFIX_RE)?.[1] ?? "";
      const body = line.slice(prefix.length);
      const trimmed = body.trimEnd();
      if (!trimmed.trim()) return line;
      return `${prefix}${open}${trimmed}${close}${body.slice(trimmed.length)}`;
    })
    .join("\n");
}

export function formatSelection(state: EditorState, kind: FormatKind): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (text.includes("\n") && !BLOCK[kind]) {
      const [open, close] = INLINE[kind];
      const wrapped = wrapEachLine(text, open, close);
      return {
        changes: { from: range.from, to: range.to, insert: wrapped },
        range: EditorSelection.range(range.from, range.from + wrapped.length),
      };
    }
    const [open, close] = delimitersFor(kind, text);

    // Selection is the wrapped text itself: unwrap.
    if (isWrappedBy(text, open, close, kind)) {
      const inner = text.slice(open.length, text.length - close.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }
    // Delimiters sit just outside the selection: unwrap them.
    const outside = state.sliceDoc(range.from - open.length, range.from) === open &&
      state.sliceDoc(range.to, range.to + close.length) === close;
    if (outside && range.from - open.length >= 0) {
      return {
        changes: [
          { from: range.from - open.length, to: range.from, insert: "" },
          { from: range.to, to: range.to + close.length, insert: "" },
        ],
        range: EditorSelection.range(range.from - open.length, range.to - open.length),
      };
    }
    // Wrap. An empty selection leaves the cursor between the delimiters.
    return {
      changes: [
        { from: range.from, insert: open },
        { from: range.to, insert: close },
      ],
      range: EditorSelection.range(range.from + open.length, range.to + open.length),
    };
  });
}

export type LineKind = "heading" | "bullet" | "numbered" | "quote";

const LINE_MATCH: Record<LineKind, RegExp> = {
  heading: /^#{1,6}\s+/,
  bullet: /^[-*+]\s+/,
  numbered: /^\d+\.\s+/,
  quote: /^>\s?/,
};

/** Toggles a line format on every line the selection touches: removes it when all
    those lines already have it, otherwise adds it (numbering lists from 1). */
export function toggleLines(state: EditorState, kind: LineKind): TransactionSpec {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) numbers.add(n);
  }
  const lines = [...numbers].sort((a, b) => a - b).map((n) => state.doc.line(n));
  const filled = lines.filter((line) => line.text.trim());
  const target = filled.length ? filled : lines;
  const remove = target.every((line) => LINE_MATCH[kind].test(line.text));
  const changes = target.map((line, index) => {
    if (remove) return { from: line.from, to: line.from + (line.text.match(LINE_MATCH[kind])?.[0].length ?? 0), insert: "" };
    const prefix = kind === "heading" ? "## " : kind === "bullet" ? "- " : kind === "numbered" ? `${index + 1}. ` : "> ";
    return { from: line.from, insert: prefix };
  });
  // A cursor at the start of a line moves past the new prefix, so typing continues the item.
  const changeSet = state.changes(changes);
  return { changes: changeSet, selection: state.selection.map(changeSet, 1) };
}

/** Wraps the selection as a markdown link and selects the url to type over. */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to) || "link";
    const insert = `[${text}](url)`;
    const urlStart = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
}
