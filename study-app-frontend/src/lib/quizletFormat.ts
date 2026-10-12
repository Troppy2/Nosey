// Quizlet import/export text format.
//
// Quizlet's Export (website only, sets you created) and its "Import your data"
// box both use plain text: a separator between term and definition, another
// between cards. The defaults are a tab and a new line. Everything here is
// pure so the modal and the tests share one parser.

export type TermSeparator = "tab" | "comma" | "dash" | "custom";
export type RowSeparator = "newline" | "semicolon" | "alternating" | "custom";

export type Separators = {
  term: TermSeparator;
  row: RowSeparator;
  customTerm?: string;
  customRow?: string;
};

export type ParsedCard = { front: string; back: string };

// One row in the import review. `reworded` marks a pair Kojo's tidy pass
// could not find word for word in the paste.
export type CardDraft = {
  id: number;
  front: string;
  back: string;
  include: boolean;
  reworded?: boolean;
};

export type CardIssue = "missing" | "too-long" | "duplicate" | "reworded";

// Matches the server caps in schemas/flashcard_schema.py.
export const IMPORT_MAX_CARDS = 1000;
export const IMPORT_MAX_SIDE_CHARS = 5000;
export const TIDY_MAX_CHARS = 12000;

export const DEFAULT_SEPARATORS: Separators = { term: "tab", row: "newline" };

const TERM_TOKENS: Record<Exclude<TermSeparator, "custom">, string> = {
  tab: "\t",
  comma: ",",
  dash: " - ",
};

function termToken(seps: Separators): string {
  if (seps.term === "custom") return seps.customTerm || "\t";
  return TERM_TOKENS[seps.term];
}

function rowToken(seps: Separators): string {
  if (seps.row === "semicolon") return ";";
  if (seps.row === "custom") return seps.customRow || "\n";
  return "\n";
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Split pasted text into cards. Splits on the FIRST term separator only, so a
 * definition keeps its own commas or dashes. A row with no separator becomes a
 * card with an empty back, which the review flags as missing. */
export function parseCardText(text: string, seps: Separators): ParsedCard[] {
  const normalized = normalizeNewlines(text);

  if (seps.row === "alternating") {
    const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    const cards: ParsedCard[] = [];
    for (let i = 0; i < lines.length; i += 2) {
      cards.push({ front: lines[i], back: lines[i + 1] ?? "" });
    }
    return cards;
  }

  const term = termToken(seps);
  // Quizlet's export always writes a tab on every card row, so with the
  // default separators a line WITHOUT a tab is the rest of the previous
  // card's multi-line definition, not a new card.
  const continuationLines = seps.term === "tab" && seps.row === "newline";
  const cards: ParsedCard[] = [];
  for (const raw of normalized.split(rowToken(seps))) {
    const row = raw.trim();
    if (!row) continue;
    // Search the untrimmed row: Quizlet writes an empty definition as
    // "term<TAB>", and trimming first would lose that tab.
    const at = raw.indexOf(term);
    if (at < 0) {
      const previous = cards[cards.length - 1];
      if (continuationLines && previous && previous.back) {
        previous.back = `${previous.back}\n${row}`;
      } else {
        cards.push({ front: row, back: "" });
      }
      continue;
    }
    cards.push({ front: raw.slice(0, at).trim(), back: raw.slice(at + term.length).trim() });
  }
  return cards;
}

/** Best guess at the separators a paste uses. Never picks "alternating" or
 * "custom": those stay a manual choice. */
export function detectSeparators(text: string): Separators {
  const normalized = normalizeNewlines(text);
  const lines = normalized.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return { ...DEFAULT_SEPARATORS };

  if (normalized.includes("\t")) {
    // More tabs than lines means several cards per line: Quizlet's
    // "Semicolon" row option.
    const tabs = normalized.split("\t").length - 1;
    const semicolonRows = tabs > lines.length && normalized.includes(";");
    return { term: "tab", row: semicolonRows ? "semicolon" : "newline" };
  }

  const majority = Math.max(1, Math.ceil(lines.length * 0.6));
  if (lines.filter((line) => line.includes(" - ")).length >= majority) return { term: "dash", row: "newline" };
  if (lines.filter((line) => line.includes(",")).length >= majority) return { term: "comma", row: "newline" };
  return { ...DEFAULT_SEPARATORS };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One `term<TAB>definition` line per card, what Quizlet's "Import your data"
 * box expects with its default separators. Line breaks and tabs inside a side
 * become single spaces so no card splits in two. Maths and markdown are kept
 * as raw text (Quizlet won't render them). */
export function serializeForQuizlet(cards: ParsedCard[]): string {
  return cards
    .map((card) => `${collapseWhitespace(card.front)}\t${collapseWhitespace(card.back)}`)
    .join("\n");
}

/** Case- and whitespace-insensitive identity of a card, for duplicate checks. */
export function cardKey(front: string, back: string): string {
  return `${collapseWhitespace(front).toLowerCase()}::${collapseWhitespace(back).toLowerCase()}`;
}

/** The problem with each draft, in priority order, or undefined when it's
 * fine. A duplicate is a card already in the target folder or an earlier
 * row of this paste. */
export function draftIssues(drafts: CardDraft[], existing: ParsedCard[]): (CardIssue | undefined)[] {
  const seen = new Set(existing.map((card) => cardKey(card.front, card.back)));
  return drafts.map((draft) => {
    if (!draft.front.trim() || !draft.back.trim()) return "missing";
    if (draft.front.length > IMPORT_MAX_SIDE_CHARS || draft.back.length > IMPORT_MAX_SIDE_CHARS) return "too-long";
    const key = cardKey(draft.front, draft.back);
    if (seen.has(key)) return "duplicate";
    seen.add(key);
    return draft.reworded ? "reworded" : undefined;
  });
}

/** Review rows for freshly parsed cards. Missing, too-long and duplicate rows
 * start unticked; everything else (including reworded) starts ticked. */
export function toDrafts(
  cards: (ParsedCard & { reworded?: boolean })[],
  existing: ParsedCard[],
  startId = 1,
): CardDraft[] {
  const drafts = cards.map((card, index) => ({
    id: startId + index,
    front: card.front,
    back: card.back,
    include: true,
    reworded: card.reworded || undefined,
  }));
  const issues = draftIssues(drafts, existing);
  return drafts.map((draft, index) => {
    const issue = issues[index];
    return issue && issue !== "reworded" ? { ...draft, include: false } : draft;
  });
}

/** True when the parse looks wrong enough to offer Kojo's tidy pass: no
 * complete cards, or more than 30% of rows missing a side. */
export function looksMessy(cards: ParsedCard[]): boolean {
  if (cards.length === 0) return true;
  const missing = cards.filter((card) => !card.front || !card.back).length;
  return missing === cards.length || missing / cards.length > 0.3;
}
