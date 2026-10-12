import { describe, expect, it } from "vitest";
import {
  cardKey,
  detectSeparators,
  draftIssues,
  looksMessy,
  parseCardText,
  serializeForQuizlet,
  toDrafts,
} from "./quizletFormat";

const TAB_NEWLINE = { term: "tab", row: "newline" } as const;

describe("parseCardText", () => {
  it("reads Quizlet's default export (tab between, new line between), CRLF included", () => {
    const text = "hola\thello\r\nadios\tgoodbye\r\n\r\n";
    expect(parseCardText(text, TAB_NEWLINE)).toEqual([
      { front: "hola", back: "hello" },
      { front: "adios", back: "goodbye" },
    ]);
  });

  it("splits on the first separator only, so definitions keep theirs", () => {
    expect(parseCardText("Paris, France, the capital", { term: "comma", row: "newline" })).toEqual([
      { front: "Paris", back: "France, the capital" },
    ]);
    expect(parseCardText("x - y - z", { term: "dash", row: "newline" })).toEqual([{ front: "x", back: "y - z" }]);
  });

  it("supports semicolon and custom separators", () => {
    expect(parseCardText("a\tb;c\td;", { term: "tab", row: "semicolon" })).toEqual([
      { front: "a", back: "b" },
      { front: "c", back: "d" },
    ]);
    expect(
      parseCardText("cat::gato||dog::perro", { term: "custom", customTerm: "::", row: "custom", customRow: "||" }),
    ).toEqual([
      { front: "cat", back: "gato" },
      { front: "dog", back: "perro" },
    ]);
  });

  it("pairs alternating lines, leaving an odd last line without a back", () => {
    expect(parseCardText("Mitosis\nCell division\n\nOsmosis", { term: "tab", row: "alternating" })).toEqual([
      { front: "Mitosis", back: "Cell division" },
      { front: "Osmosis", back: "" },
    ]);
  });

  it("joins a tab-less line onto the previous card's definition (multi-line definitions)", () => {
    const text = "Krebs cycle\tStep 1: acetyl-CoA\nStep 2: citrate\nATP\tenergy";
    expect(parseCardText(text, TAB_NEWLINE)).toEqual([
      { front: "Krebs cycle", back: "Step 1: acetyl-CoA\nStep 2: citrate" },
      { front: "ATP", back: "energy" },
    ]);
  });

  it("keeps Quizlet's empty definition (term then a bare tab) as its own card", () => {
    expect(parseCardText("Krebs cycle\tcitrate\ngato\t\n\tno term", TAB_NEWLINE)).toEqual([
      { front: "Krebs cycle", back: "citrate" },
      { front: "gato", back: "" },
      { front: "", back: "no term" },
    ]);
  });

  it("keeps a row with no separator as a card missing its back", () => {
    expect(parseCardText("just a term", { term: "comma", row: "newline" })).toEqual([
      { front: "just a term", back: "" },
    ]);
  });
});

describe("detectSeparators", () => {
  it("picks tab/new line when tabs are present", () => {
    expect(detectSeparators("a\tb\nc\td")).toEqual({ term: "tab", row: "newline" });
  });

  it("picks semicolon rows when there are more tabs than lines", () => {
    expect(detectSeparators("a\tb;c\td;e\tf")).toEqual({ term: "tab", row: "semicolon" });
  });

  it("picks dash, then comma, by majority of lines", () => {
    expect(detectSeparators("a - b\nc - d\ne, f")).toEqual({ term: "dash", row: "newline" });
    expect(detectSeparators("a, b\nc, d\ne")).toEqual({ term: "comma", row: "newline" });
  });

  it("falls back to the defaults for an unstructured paste", () => {
    expect(detectSeparators("Terms in this set (2)\nMitosis\nCell division")).toEqual(TAB_NEWLINE);
  });
});

describe("serializeForQuizlet", () => {
  it("writes one tab-separated line per card, collapsing inner line breaks and tabs", () => {
    const text = serializeForQuizlet([
      { front: "Derivative of $x^2$", back: "$2x$\n\nby the power rule" },
      { front: "a\tb", back: "  c  " },
    ]);
    expect(text).toBe("Derivative of $x^2$\t$2x$ by the power rule\na b\tc");
  });

  it("round-trips through the parser with the default separators", () => {
    const cards = [
      { front: "hola", back: "hello, hi" },
      { front: "adios", back: "goodbye - bye" },
    ];
    expect(parseCardText(serializeForQuizlet(cards), TAB_NEWLINE)).toEqual(cards);
  });
});

describe("review drafts", () => {
  it("flags duplicates against the folder and within the paste, case and space insensitive", () => {
    const drafts = toDrafts(
      [
        { front: "Hola", back: "Hello" },
        { front: "adios", back: "goodbye" },
        { front: "adios ", back: "Goodbye" },
        { front: "gato", back: "" },
      ],
      [{ front: "hola", back: "hello" }],
    );
    expect(drafts.map((d) => d.include)).toEqual([false, true, false, false]);
    expect(draftIssues(drafts, [{ front: "hola", back: "hello" }])).toEqual([
      "duplicate",
      undefined,
      "duplicate",
      "missing",
    ]);
  });

  it("keeps reworded tidy rows ticked but flagged", () => {
    const drafts = toDrafts([{ front: "a", back: "b", reworded: true }], []);
    expect(drafts[0].include).toBe(true);
    expect(draftIssues(drafts, [])).toEqual(["reworded"]);
  });

  it("flags a side over the server cap", () => {
    const drafts = toDrafts([{ front: "a", back: "x".repeat(5001) }], []);
    expect(drafts[0].include).toBe(false);
    expect(draftIssues(drafts, [])).toEqual(["too-long"]);
  });

  it("cardKey ignores case and extra whitespace", () => {
    expect(cardKey(" Hola  amigo", "HELLO")).toBe(cardKey("hola amigo", "hello"));
  });
});

describe("looksMessy", () => {
  it("is true for no cards or mostly-incomplete rows, false for a clean parse", () => {
    expect(looksMessy([])).toBe(true);
    expect(looksMessy([{ front: "a", back: "" }, { front: "b", back: "c" }])).toBe(true);
    expect(looksMessy([{ front: "a", back: "b" }, { front: "c", back: "d" }])).toBe(false);
  });
});
