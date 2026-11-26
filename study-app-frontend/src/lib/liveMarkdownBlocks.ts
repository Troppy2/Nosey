// Splits a markdown answer into the blocks the live-preview editor renders one at
// a time (MarkdownLiveEditor). Obsidian's Live Preview keeps the block under the
// cursor raw and draws every other block formatted; a block here is one unit of
// that: a heading line, a run of "> " quote/callout lines, a fenced code block, a
// $$ display-math block, or a run of other consecutive non-blank lines (a
// paragraph, list or table). Offsets are into the whole document.

export type LiveBlock = { from: number; to: number; text: string };

const isBlank = (line: string) => line.trim() === "";
const isHeading = (line: string) => /^#{1,6}\s/.test(line);
const isQuote = (line: string) => /^\s{0,3}>/.test(line);
const isFenceOpen = (line: string) => line.trimStart().startsWith("```");
const opensDisplayMath = (line: string) => {
  const t = line.trim();
  return t.startsWith("$$") && (t === "$$" || !t.slice(2).includes("$$"));
};

export function splitLiveBlocks(doc: string): LiveBlock[] {
  const lines = doc.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const blocks: LiveBlock[] = [];
  const push = (first: number, last: number) => {
    const from = starts[first];
    const to = starts[last] + lines[last].length;
    blocks.push({ from, to, text: doc.slice(from, to) });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const first = i;
    if (isFenceOpen(line)) {
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) i++;
      const last = Math.min(i, lines.length - 1);
      push(first, last);
      i = last + 1;
      continue;
    }
    if (opensDisplayMath(line)) {
      i++;
      while (i < lines.length && !lines[i].trim().endsWith("$$")) i++;
      const last = Math.min(i, lines.length - 1);
      push(first, last);
      i = last + 1;
      continue;
    }
    if (isHeading(line)) {
      push(first, first);
      i++;
      continue;
    }
    const quote = isQuote(line);
    i++;
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      isQuote(lines[i]) === quote &&
      (quote || (!isHeading(lines[i]) && !isFenceOpen(lines[i]) && !opensDisplayMath(lines[i])))
    ) {
      i++;
    }
    push(first, i - 1);
  }
  return blocks;
}

// Maps a click inside a rendered block back to a source offset. `before` is the
// rendered text up to the click. Tries the longest tail of it (down to 3 chars)
// that appears in the raw block, picking the occurrence closest to where the
// click sits proportionally; falls back to that proportion. Formatting marks
// (==, **, > [!tip]) are absent from the rendered text, so a short tail usually
// still matches a run of plain words.
export function rawOffsetForRenderedClick(raw: string, before: string, renderedLength: number): number {
  const ratio = renderedLength > 0 ? Math.min(1, before.length / renderedLength) : 1;
  const guess = Math.round(raw.length * ratio);
  for (let len = Math.min(16, before.length); len >= 3; len--) {
    const tail = before.slice(before.length - len);
    let best = -1;
    let bestDistance = Infinity;
    for (let at = raw.indexOf(tail); at !== -1; at = raw.indexOf(tail, at + 1)) {
      const end = at + tail.length;
      const distance = Math.abs(end - guess);
      if (distance < bestDistance) {
        best = end;
        bestDistance = distance;
      }
    }
    if (best !== -1) return best;
  }
  return Math.max(0, Math.min(raw.length, guess));
}
