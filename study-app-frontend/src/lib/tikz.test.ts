import { describe, expect, it } from "vitest";
import { TIKZ_FALLBACK, replaceTikz } from "./tikz";

const PMF =
  "\\begin{tikzpicture} \\draw (0,0) -- (5,0); \\draw (0,0) rectangle (0.8,3.5); \\node at (0.4,-0.3) {0}; \\end{tikzpicture}";

describe("replaceTikz", () => {
  it("swaps a picture for the fallback note", () => {
    expect(replaceTikz(`The PMF:\n\n${PMF}\n\nDone.`)).toBe(`The PMF:\n\n${TIKZ_FALLBACK}\n\nDone.`);
  });

  it("also catches one wrapped in $$ or cut off before its end", () => {
    expect(replaceTikz(`$$${PMF}$$`)).toBe(TIKZ_FALLBACK);
    expect(replaceTikz("See \\begin{tikzpicture} \\draw (0,0)")).toBe(`See ${TIKZ_FALLBACK}`);
  });

  it("leaves code fences and ordinary math alone", () => {
    const fenced = "```latex\n" + PMF + "\n```";
    expect(replaceTikz(fenced)).toBe(fenced);
    expect(replaceTikz("$$\\begin{cases} 1 \\\\ 0 \\end{cases}$$")).toBe("$$\\begin{cases} 1 \\\\ 0 \\end{cases}$$");
  });
});
