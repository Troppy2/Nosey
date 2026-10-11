import { describe, expect, it } from "vitest";
import {
  PASTE_TEXT_MAX_CHARS,
  PASTE_TEXT_MAX_WORDS,
  countWords,
  layoutTextAsInk,
  normalizeForPen,
} from "./textToInk";

// ScratchPad.tsx limits a pasted block has to fit inside, on an empty pad.
const MAX_STROKES_PER_QUESTION = 1500;
const MAX_STROKES_JSON_CHARS = 180_000;
const SCALE = 1.15;
const PAGE_WIDTH = 1000 - 80;

const SENTENCE =
  "The derivative of a function measures how its output changes as its input changes, so f'(x) = 2x + 3 here. ";

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

describe("countWords", () => {
  it("counts words across spaces, tabs and new lines", () => {
    expect(countWords("  one two\tthree\nfour  ")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });
});

describe("normalizeForPen", () => {
  it("writes common symbols out and drops accents", () => {
    const { text, replaced } = normalizeForPen("\u03c0r\u00b2 \u2264 \u221a2 \u2014 caf\u00e9 \u201cok\u201d");
    expect(text).toBe("pir^2 <= sqrt2 - cafe \"ok\"");
    expect(replaced).toBe(0);
  });

  it("turns characters the font cannot draw into ? and counts them", () => {
    const { text, replaced } = normalizeForPen("a\u4e2db\u{1f600}");
    expect(text).toBe("a?b?");
    expect(replaced).toBe(2);
  });

  it("unifies line endings", () => {
    expect(normalizeForPen("a\r\nb\rc").text).toBe("a\nb\nc");
  });
});

describe("layoutTextAsInk", () => {
  it("draws every glyph as strokes inside the page width", () => {
    const laid = layoutTextAsInk(SENTENCE.repeat(3).trim(), PAGE_WIDTH, SCALE);
    expect(laid.strokes.length).toBeGreaterThan(50);
    expect(laid.width).toBeLessThanOrEqual(PAGE_WIDTH + 0.001);
    for (const points of laid.strokes) {
      expect(points.length % 2).toBe(0);
      for (let i = 0; i < points.length; i += 2) {
        expect(points[i]).toBeGreaterThanOrEqual(0);
        expect(points[i]).toBeLessThanOrEqual(PAGE_WIDTH + 0.001);
      }
    }
  });

  it("wraps onto more lines when the page is narrower", () => {
    const text = SENTENCE.trim();
    const wide = layoutTextAsInk(text, PAGE_WIDTH, SCALE);
    const narrow = layoutTextAsInk(text, PAGE_WIDTH / 3, SCALE);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });

  it("splits a word longer than a line instead of running off the page", () => {
    const laid = layoutTextAsInk("CSCI2033_Midterm1_Targeted_Worksheet_".repeat(4), 300, SCALE);
    expect(laid.width).toBeLessThanOrEqual(300.001);
    expect(laid.height).toBeGreaterThan(40);
  });

  it("keeps blank lines", () => {
    const one = layoutTextAsInk("a", PAGE_WIDTH, SCALE);
    const gap = layoutTextAsInk("a\n\nb", PAGE_WIDTH, SCALE);
    expect(gap.height).toBeCloseTo(one.height * 3);
  });

  it("fits a full-length paste inside the pad's stroke and size limits", () => {
    const words = SENTENCE.trim().split(" ");
    const text = Array.from({ length: PASTE_TEXT_MAX_WORDS }, (_, i) => words[i % words.length]).join(" ");
    expect(countWords(text)).toBe(PASTE_TEXT_MAX_WORDS);
    expect(text.length).toBeLessThanOrEqual(PASTE_TEXT_MAX_CHARS);
    const laid = layoutTextAsInk(normalizeForPen(text).text, PAGE_WIDTH, SCALE);
    const strokes = laid.strokes.map((points) => ({ points: points.map(round1) }));
    expect(strokes.length).toBeLessThan(MAX_STROKES_PER_QUESTION);
    expect(JSON.stringify({ version: 1, strokes }).length).toBeLessThan(MAX_STROKES_JSON_CHARS);
  });
});
