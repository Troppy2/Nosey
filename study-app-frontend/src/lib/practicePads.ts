// Practice scratch pads inside an article lesson.
//
// The author (an MCP agent) writes [[scratchpad]] as a paragraph of its own
// right after a problem statement. The block right before the marker is the
// problem; every block after it, up to the next heading, horizontal rule,
// marker or the end of the lesson, is the walkthrough, which stays collapsed
// until the pad is done or given up. Mirrors is_scratchpad_block /
// check_scratchpads in study-app-backend/src/utils/lesson_blocks.py: the
// backend counts markers the same way to index practice_progress.

export const SCRATCHPAD_MARKER = "[[scratchpad]]";

const HEADING = /^\s*#{1,6}\s/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function isScratchpadBlock(block: string): boolean {
  return block.trim().toLowerCase() === SCRATCHPAD_MARKER;
}

function endsWalkthrough(block: string): boolean {
  const first = block.replace(/^\n+/, "").split("\n", 1)[0];
  return HEADING.test(first) || RULE.test(block) || isScratchpadBlock(block);
}

export type PracticePad = {
  // Ordinal among the lesson's markers: the index into practice_progress.
  index: number;
  markerBlock: number;
  // The whole problem shown on the pad: every block from the section start
  // (heading, rule, previous marker or walkthrough) down to the marker, so a
  // multi-part problem (setup, (a), (b), (c)) arrives whole, not just its last
  // paragraph.
  problemText: string;
  walkthroughBlocks: number[];
};

// Lines of a block that are not headings. A heading written with no blank
// line before its text still contributes that text.
function withoutHeadings(block: string): string {
  return block
    .split("\n")
    .filter((line) => !HEADING.test(line))
    .join("\n")
    .trim();
}

function problemTextFor(blocks: string[], markerIndex: number, walkthroughOf: number[]): string {
  const parts: string[] = [];
  for (let j = markerIndex - 1; j >= 0; j--) {
    const block = blocks[j];
    if (isScratchpadBlock(block) || RULE.test(block) || walkthroughOf[j] >= 0) break;
    const first = block.replace(/^\n+/, "").split("\n", 1)[0];
    if (HEADING.test(first)) {
      const rest = withoutHeadings(block);
      if (rest) parts.unshift(rest);
      break;
    }
    parts.unshift(block);
  }
  return parts.join("\n\n");
}

export type PracticeLayout = {
  pads: PracticePad[];
  // For every block: the pad whose walkthrough holds it, else -1.
  walkthroughOf: number[];
  // For every block: the pad index when the block IS a marker, else -1.
  padAt: number[];
};

export function practiceLayout(blocks: string[]): PracticeLayout {
  const pads: PracticePad[] = [];
  const walkthroughOf = blocks.map(() => -1);
  const padAt = blocks.map(() => -1);
  blocks.forEach((block, i) => {
    if (!isScratchpadBlock(block)) return;
    const pad: PracticePad = {
      index: pads.length,
      markerBlock: i,
      problemText: problemTextFor(blocks, i, walkthroughOf),
      walkthroughBlocks: [],
    };
    for (let j = i + 1; j < blocks.length && !endsWalkthrough(blocks[j]); j++) {
      pad.walkthroughBlocks.push(j);
      walkthroughOf[j] = pad.index;
    }
    padAt[i] = pad.index;
    pads.push(pad);
  });
  return { pads, walkthroughOf, padAt };
}
