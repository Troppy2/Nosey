import { describe, expect, it } from "vitest";

import { repairMathDelimiters } from "./repairMathDelimiters";

const B = "\\"; // one backslash, spelled out so the source stays readable
const RS = B + B; // a LaTeX row separator

describe("repairMathDelimiters", () => {
  // ── The damage from the bug report ────────────────────────────────────────

  it("rewraps an orphaned run back into one display block", () => {
    const damaged = "$$" + B + "mathbf{c} = $$ 1 " + RS + " 2 " + RS + " 3 $$";
    expect(repairMathDelimiters(damaged)).toBe(
      "$$" + B + "mathbf{c} = " + B + "begin{bmatrix} 1 " + RS + " 2 " + RS + " 3 " + B + "end{bmatrix}$$",
    );
  });

  it("repairs a matrix whose cells are separated by ampersands", () => {
    const damaged = "$$D = $$ 0 & 1 & 0 " + RS + " 0 & 0 & 2 $$";
    expect(repairMathDelimiters(damaged)).toBe(
      "$$D = " + B + "begin{bmatrix} 0 & 1 & 0 " + RS + " 0 & 0 & 2 " + B + "end{bmatrix}$$",
    );
  });

  it("repairs both runs in the reported article and leaves the prose alone", () => {
    const article = [
      "The coefficient vector is:",
      "",
      "$$" + B + "mathbf{c} = $$ 1 " + RS + " 2 " + RS + " 3 $$",
      "",
      "(constant term first). This vector *encodes* the polynomial completely.",
      "",
      "## Computing the Derivative",
      "",
      "The derivative $f'(x) = 6x + 2$ has coefficients $[2, 6]$.",
      "",
      "$$D = $$ 0 & 1 & 0 " + RS + " 0 & 0 & 2 $$",
    ].join("\n");

    const fixed = repairMathDelimiters(article);
    expect((fixed.match(/\$\$/g) ?? []).length).toBe(4);
    expect((fixed.match(/begin\{bmatrix\}/g) ?? []).length).toBe(2);
    expect(fixed).toContain("(constant term first). This vector *encodes* the polynomial completely.");
    expect(fixed).toContain("\n## Computing the Derivative\n");
    expect(fixed).toContain("$f'(x) = 6x + 2$");
  });

  it("repairs a balanced block that lost its wrapper", () => {
    // A matrix with no head: the old cleanup collapsed $$$$ on both sides, so
    // the delimiters balance but & is a hard KaTeX error without an environment.
    const damaged = "$$ 1 & 0 " + RS + " 0 & 1 $$";
    expect(repairMathDelimiters(damaged)).toBe(
      "$$" + B + "begin{bmatrix} 1 & 0 " + RS + " 0 & 1 " + B + "end{bmatrix}$$",
    );
  });

  it("chooses aligned when the body aligns on a relation", () => {
    const damaged = "$$ x &= 1 " + RS + " y &= 2 $$";
    const fixed = repairMathDelimiters(damaged);
    expect(fixed).toContain(B + "begin{aligned}");
    expect(fixed).toContain(B + "end{aligned}");
    expect(fixed).not.toContain("bmatrix");
  });

  // ── It must not invent damage ─────────────────────────────────────────────

  it("is a no-op on undamaged maths", () => {
    const clean = "$$" + B + "mathbf{c} = " + B + "begin{bmatrix} 1 " + RS + " 2 " + B + "end{bmatrix}$$";
    expect(repairMathDelimiters(clean)).toBe(clean);
  });

  it("is a no-op on content with no display maths at all", () => {
    const clean = "# Title\n\nSome **bold** prose with $x^2$ inline.\n\n- item\n";
    expect(repairMathDelimiters(clean)).toBe(clean);
  });

  it("leaves two adjacent display blocks with prose between them alone", () => {
    const clean = "$$a^2$$ and then $$b^2$$";
    expect(repairMathDelimiters(clean)).toBe(clean);
  });

  it("does not treat prose containing an ampersand as a matrix body", () => {
    const clean = "$$x$$ comparing Alpha & Beta across the board $$y$$";
    expect(repairMathDelimiters(clean)).toBe(clean);
  });

  it("does not wrap a multi-line display equation that has no ampersand", () => {
    // Genuine multi-line display maths. \\ alone is legal there, so wrapping
    // would invent brackets that were never in the source.
    const clean = "$$ x = 1 " + RS + " y = 2 $$";
    expect(repairMathDelimiters(clean)).toBe(clean);
  });

  it("leaves a body that already has an environment alone", () => {
    const clean = "$$A = $$ " + B + "begin{pmatrix} 1 " + RS + " 2 " + B + "end{pmatrix} $$";
    expect(repairMathDelimiters(clean)).toBe(clean);
  });

  it("never touches a fenced code block", () => {
    const source = "```latex\n$$M = $$ 1 & 0 " + RS + " 0 & 1 $$\n```\n";
    expect(repairMathDelimiters(source)).toBe(source);
  });

  it("never touches an inline code span", () => {
    const source = "Write `$$M = $$ 1 & 2 " + RS + " 3 & 4 $$` to see it.";
    expect(repairMathDelimiters(source)).toBe(source);
  });

  it("repairs prose around a code block without disturbing the code", () => {
    const source =
      "```bash\necho $HOME\n```\n\n$$M = $$ 1 & 0 " + RS + " 0 & 1 $$\n";
    const fixed = repairMathDelimiters(source);
    expect(fixed).toContain("```bash\necho $HOME\n```");
    expect(fixed).toContain(B + "begin{bmatrix}");
  });

  it("does not swallow a heading into a repaired block", () => {
    const source = "$$x = $$\n\n## A heading\n\nProse " + RS + " more\n\n$$";
    expect(repairMathDelimiters(source)).toBe(source);
  });

  // ── Contract ──────────────────────────────────────────────────────────────

  it("is idempotent", () => {
    for (const source of [
      "$$" + B + "mathbf{c} = $$ 1 " + RS + " 2 $$",
      "$$ 1 & 0 " + RS + " 0 & 1 $$",
      "$$ x &= 1 " + RS + " y &= 2 $$",
      "$$a^2$$ and then $$b^2$$",
      "# Title\n\nProse.\n",
    ]) {
      const once = repairMathDelimiters(source);
      expect(repairMathDelimiters(once)).toBe(once);
    }
  });

  it("handles empty input", () => {
    expect(repairMathDelimiters("")).toBe("");
  });

  it("never changes the prose words of an article", () => {
    const article =
      "Intro prose here.\n\n$$" + B + "mathbf{c} = $$ 1 " + RS + " 2 $$\n\nClosing prose here.\n";
    const fixed = repairMathDelimiters(article);
    expect(fixed).toContain("Intro prose here.");
    expect(fixed).toContain("Closing prose here.");
  });
});
