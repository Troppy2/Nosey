// Lays pasted text out as pen strokes for the scratch pad, using the
// single-stroke glyphs in penFont.ts. Plain characters only: math is drawn
// exactly as typed (x^2 stays x^2), and symbols the font lacks are written
// out ("pi", "<=") or drawn as "?".

import { PEN_FONT_SPACE_ADVANCE, PEN_GLYPHS } from "./penFont";

// About what an empty pad holds: ~7.5 strokes and ~50 points per word against
// the pad's 1,500-stroke and 180K-character limits, with room left for working.
export const PASTE_TEXT_MAX_WORDS = 150;
// So 150 "words" of one long run of characters cannot slip past the word cap.
export const PASTE_TEXT_MAX_CHARS = 1200;

// Font units (cap height is 21): baseline-to-baseline distance between lines.
const LINE_HEIGHT = 40;

// Common symbols the font has no glyph for, written out instead. Escapes, not
// literal characters, so this file stays plain ASCII.
const FALLBACKS: Readonly<Record<string, string>> = {
  "\u00a0": " ", "\t": "  ",
  "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u2032": "'",
  "\u201c": "\"", "\u201d": "\"", "\u201e": "\"", "\u2033": "\"",
  "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2212": "-",
  "\u2022": "-", "\u00b7": "*", "\u22c5": "*", "\u00d7": "x", "\u00f7": "/", "\u2215": "/",
  "\u2026": "...", "\u00b1": "+/-", "\u2264": "<=", "\u2265": ">=", "\u2260": "!=", "\u2248": "~=",
  "\u2261": "==", "\u2192": "->", "\u2190": "<-", "\u2194": "<->", "\u21d2": "=>", "\u21d4": "<=>",
  "\u221a": "sqrt", "\u221e": "inf", "\u2211": "sum", "\u222b": "integral", "\u2202": "d",
  "\u2208": " in ", "\u2200": "for all ", "\u2203": "exists ", "\u00b0": " deg",
  "\u00b2": "^2", "\u00b3": "^3", "\u00b9": "^1", "\u2070": "^0", "\u2074": "^4",
  "\u03b1": "alpha", "\u03b2": "beta", "\u03b3": "gamma", "\u0393": "Gamma", "\u03b4": "delta",
  "\u0394": "Delta", "\u03b5": "epsilon", "\u03b8": "theta", "\u03bb": "lambda", "\u03bc": "mu",
  "\u03c0": "pi", "\u03a0": "Pi", "\u03c1": "rho", "\u03c3": "sigma", "\u03a3": "Sigma",
  "\u03c4": "tau", "\u03c6": "phi", "\u03c9": "omega", "\u03a9": "Omega",
};

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Text the font can draw: symbols written out, accents dropped (e -> e), line
// endings unified, and anything else turned into "?". replaced counts those.
export function normalizeForPen(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = "";
  const unified = text.replace(/\r\n?/g, "\n");
  for (const raw of unified) {
    const mapped = FALLBACKS[raw] ?? raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    for (const ch of mapped) {
      if (ch === "\n" || ch === " " || PEN_GLYPHS[ch]) {
        out += ch;
      } else {
        out += "?";
        replaced += 1;
      }
    }
  }
  return { text: out, replaced };
}

function advance(ch: string): number {
  if (ch === " ") return PEN_FONT_SPACE_ADVANCE;
  const glyph = PEN_GLYPHS[ch];
  return glyph ? glyph[0] * 2 : PEN_FONT_SPACE_ADVANCE;
}

function wordWidth(word: string): number {
  let width = 0;
  for (const ch of word) width += advance(ch);
  return width;
}

// The polylines of one glyph, shifted to (x, y), in font units.
function glyphStrokes(ch: string, x: number, y: number): number[][] {
  const glyph = PEN_GLYPHS[ch];
  if (!glyph) return [];
  return glyph[1].split("|").map((polyline) => {
    const points: number[] = [];
    for (const pair of polyline.split(" ")) {
      const [px, py] = pair.split(",");
      points.push(x + Number(px), y + Number(py));
    }
    return points;
  });
}

export type InkText = {
  strokes: number[][];
  width: number;
  height: number;
};

// Wraps the text to maxWidth (in output units) and returns its strokes scaled
// by scale, top-left at (0, 0). A word wider than a line is split by letter;
// blank lines are kept.
export function layoutTextAsInk(text: string, maxWidth: number, scale: number): InkText {
  const lineWidth = Math.max(PEN_FONT_SPACE_ADVANCE * 4, maxWidth / scale);
  const strokes: number[][] = [];
  let widest = 0;
  let line = 0;

  for (const paragraph of text.split("\n")) {
    let x = 0;
    const words = paragraph.split(" ");
    words.forEach((word, index) => {
      const space = index === 0 ? 0 : PEN_FONT_SPACE_ADVANCE;
      const width = wordWidth(word);
      if (x > 0 && x + space + width > lineWidth) {
        line += 1;
        x = 0;
      } else {
        x += space;
      }
      for (const ch of word) {
        const step = advance(ch);
        if (x > 0 && x + step > lineWidth) {
          line += 1;
          x = 0;
        }
        strokes.push(...glyphStrokes(ch, x, line * LINE_HEIGHT));
        x += step;
        widest = Math.max(widest, x);
      }
    });
    line += 1;
  }

  return {
    strokes: strokes.map((points) => points.map((v) => v * scale)),
    width: widest * scale,
    height: line * LINE_HEIGHT * scale,
  };
}
