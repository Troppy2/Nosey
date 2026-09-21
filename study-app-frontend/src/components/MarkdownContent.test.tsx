import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { extractMath, MarkdownContent } from "./MarkdownContent";
import { repairMathDelimiters } from "../lib/repairMathDelimiters";

// The sources handed to KaTeX, in document order. Read from extractMath rather
// than the DOM because the renderer emits HTML only, with no MathML annotation
// to read the original expression back out of.
const mathSourcesOf = (content: string) => extractMath(content)[1].map((e) => e.src);

afterEach(cleanup);

// Renders `content` and hands back the container plus a few helpers. KaTeX is
// configured with throwOnError: false, so a broken expression does not throw,
// it renders a red <span class="katex-error"> holding the whole source. That
// element is therefore the single best signal that the math pipeline handed
// KaTeX something it never should have seen.
function md(content: string) {
  const { container } = render(<MarkdownContent content={content} />);
  return {
    container,
    text: container.textContent ?? "",
    errors: Array.from(container.querySelectorAll(".katex-error")).map((e) => e.textContent ?? ""),
    blocks: Array.from(container.querySelectorAll(".math-block")),
    inlines: Array.from(container.querySelectorAll(".math-inline")),
    code: Array.from(container.querySelectorAll("pre.kojo-code-block code")).map((e) => e.textContent ?? ""),
  };
}

function expectNoMathErrors(r: ReturnType<typeof md>) {
  expect(r.errors).toEqual([]);
}

// ── Plain markdown ───────────────────────────────────────────────────────────

describe("plain markdown", () => {
  it("renders headings, emphasis, lists and tables", () => {
    const r = md(
      "## Section\n\nSome **bold** and *italic* prose.\n\n- one\n- two\n\n1. first\n2. second\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    );
    expect(r.container.querySelector("h4")?.textContent).toBe("Section");
    expect(r.container.querySelector("strong")?.textContent).toBe("bold");
    expect(r.container.querySelector("em")?.textContent).toBe("italic");
    expect(r.container.querySelectorAll("ul li")).toHaveLength(2);
    expect(r.container.querySelectorAll("ol li")).toHaveLength(2);
    expect(r.container.querySelectorAll("table tbody tr")).toHaveLength(1);
  });

  it("renders a fenced code block verbatim", () => {
    const r = md("```python\nfor i in range(3):\n    print(i)\n```\n");
    expect(r.code[0]).toBe("for i in range(3):\n    print(i)");
  });
});

// ── Plain LaTeX ──────────────────────────────────────────────────────────────

describe("plain LaTeX", () => {
  it("renders a lone display equation as a math block", () => {
    const r = md("$$x^2 + y^2 = z^2$$");
    expect(r.blocks).toHaveLength(1);
    expectNoMathErrors(r);
  });

  it("renders bracket-delimited display math", () => {
    const r = md("\\[x^2 + y^2 = z^2\\]");
    expect(r.blocks).toHaveLength(1);
    expectNoMathErrors(r);
  });

  it("renders bracket-delimited inline math", () => {
    const r = md("value \\(x^2\\) here");
    expect(r.inlines).toHaveLength(1);
    expectNoMathErrors(r);
  });
});

// ── Vectors and matrices: the reported failure ───────────────────────────────

describe("vector and matrix notation", () => {
  const COLUMN_VECTOR = "$$\\mathbf{c} = \\begin{bmatrix} 1 \\\\ 2 \\\\ 3 \\end{bmatrix}$$";

  it("renders a column vector as one math block with no error", () => {
    const r = md(COLUMN_VECTOR);
    expect(r.blocks).toHaveLength(1);
    expectNoMathErrors(r);
    expect(mathSourcesOf(COLUMN_VECTOR)).toEqual([
      "\\mathbf{c} = \\begin{bmatrix} 1 \\\\ 2 \\\\ 3 \\end{bmatrix}",
    ]);
  });

  it("does not leak matrix row separators into the page as text", () => {
    const r = md(COLUMN_VECTOR);
    // "1 \\ 2 \\ 3" appearing as plain text is the exact reported symptom.
    expect(r.text).not.toContain("\\\\");
  });

  it("keeps surrounding prose out of the matrix block", () => {
    const article =
      "The coefficient vector is:\n\n" +
      COLUMN_VECTOR +
      "\n\n(constant term first). This vector *encodes* the polynomial completely.\n\n" +
      "## Computing the Derivative\n\n" +
      "The derivative $f'(x) = 6x + 2$ has coefficients $[2, 6]$.\n\n" +
      "$$D = \\begin{bmatrix} 0 & 1 & 0 \\\\ 0 & 0 & 2 \\end{bmatrix}$$\n";
    const r = md(article);
    expectNoMathErrors(r);
    expect(r.blocks).toHaveLength(2);
    expect(r.container.querySelector("h4")?.textContent).toBe("Computing the Derivative");
    expect(r.container.querySelector("em")?.textContent).toBe("encodes");
    for (const source of mathSourcesOf(article)) {
      expect(source).not.toContain("constant term first");
      expect(source).not.toContain("Computing the Derivative");
    }
  });
});

// ── LaTeX inside markdown constructs ─────────────────────────────────────────

describe("LaTeX inside markdown", () => {
  it("renders inline math inside bold", () => {
    const r = md("The **value $x^2$ matters** here.");
    expect(r.container.querySelector("strong .math-inline")).not.toBeNull();
    expectNoMathErrors(r);
  });

  it("renders inline math inside italic", () => {
    const r = md("Now *distribute the $x$ term*.");
    expect(r.container.querySelector("em .math-inline")).not.toBeNull();
    expectNoMathErrors(r);
  });

  it("renders inline math inside a heading", () => {
    const r = md("## The $\\theta$ section\n\nBody.\n");
    expect(r.container.querySelector("h4 .math-inline")).not.toBeNull();
    expectNoMathErrors(r);
  });

  it("renders inline math inside list items", () => {
    const r = md("- first $x^2$\n- second $\\frac{a}{b}$\n");
    expect(r.container.querySelectorAll("ul li .math-inline")).toHaveLength(2);
    expectNoMathErrors(r);
  });

  it("renders a matrix inside a list item", () => {
    const r = md("- the matrix $\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}$ is the identity\n");
    expectNoMathErrors(r);
    expect(r.container.querySelectorAll("ul li")).toHaveLength(1);
  });

  it("renders inline math inside a table cell", () => {
    const r = md("| symbol | meaning |\n| - | - |\n| $\\pi$ | ratio |\n");
    expect(r.container.querySelector("td .math-inline")).not.toBeNull();
    expectNoMathErrors(r);
  });

  it("renders many math expressions in one response", () => {
    const r = md(
      "First $a^2$, then $b^2$, then $c^2$.\n\n$$a^2 + b^2 = c^2$$\n\nFinally $\\sqrt{c}$.\n",
    );
    expect(r.inlines).toHaveLength(4);
    expect(r.blocks).toHaveLength(1);
    expectNoMathErrors(r);
  });
});

// ── Code blocks must never be parsed as math ─────────────────────────────────

describe("code blocks containing math-like syntax", () => {
  it("keeps shell variables in a fenced block intact", () => {
    const r = md("```bash\necho $HOME and $USER\n```\n");
    expect(r.code[0]).toBe("echo $HOME and $USER");
    expect(r.blocks).toHaveLength(0);
    expect(r.inlines).toHaveLength(0);
  });

  it("keeps LaTeX source in a fenced block intact", () => {
    const r = md("```latex\n$$\\frac{a}{b}$$\n\\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix}\n```\n");
    expect(r.code[0]).toContain("\\begin{bmatrix}");
    expect(r.code[0]).toContain("$$\\frac{a}{b}$$");
    expect(r.blocks).toHaveLength(0);
  });

  it("keeps markdown syntax in a fenced block intact", () => {
    const r = md("```markdown\n## Heading\n\n- **bold** item\n```\n");
    expect(r.code[0]).toContain("## Heading");
    expect(r.code[0]).toContain("**bold** item");
    expect(r.container.querySelector("h4")).toBeNull();
    expect(r.container.querySelector("strong")).toBeNull();
  });

  it("keeps dollar signs in an inline code span intact", () => {
    const r = md("Run `echo $HOME and $USER` in the shell.");
    expect(r.container.querySelector("code")?.textContent).toBe("echo $HOME and $USER");
    expect(r.inlines).toHaveLength(0);
  });

  it("does not swallow prose that follows a code block", () => {
    const r = md("```bash\necho $A and $B\n```\n\nAfterwards the cost is 10 dollars.\n");
    expect(r.text).toContain("Afterwards the cost is 10 dollars.");
  });
});

// ── Delimiter robustness ─────────────────────────────────────────────────────

describe("delimiter handling", () => {
  it("does not treat a currency amount as inline math", () => {
    const r = md("The plan costs $5 and the tax is $2 more.");
    expect(r.inlines).toHaveLength(0);
    expect(r.text).toContain("costs $5 and the tax is $2 more.");
  });

  it("still accepts inline math padded with spaces", () => {
    const r = md("The value $ x^2 $ is positive.");
    expect(r.inlines).toHaveLength(1);
    expectNoMathErrors(r);
  });

  it("does not let an unclosed display delimiter swallow the rest of the article", () => {
    // A stray $$ is the classic way a mangled article loses several paragraphs
    // into one red KaTeX error block.
    const r = md(
      "$$x = 1$$\n\nA paragraph of prose.\n\n## A heading\n\nMore prose.\n\n$$y = 2$$\n",
    );
    expect(r.container.querySelector("h4")?.textContent).toBe("A heading");
    expect(r.text).toContain("A paragraph of prose.");
    expect(r.text).toContain("More prose.");
    expectNoMathErrors(r);
  });

  it("does not capture a heading or a blank line inside display math", () => {
    const article = "Intro.\n\n$$\n\nA paragraph.\n\n## A heading\n\nMore.\n\n$$\n";
    expect(mathSourcesOf(article)).toEqual([]);
    const r = md(article);
    expect(r.container.querySelector("h4")?.textContent).toBe("A heading");
    expect(r.text).toContain("A paragraph.");
    expect(r.text).toContain("More.");
  });

  it("does not treat an escaped dollar as a delimiter", () => {
    const r = md("A literal \\$5 and another \\$9 here.");
    expect(r.inlines).toHaveLength(0);
    expect(r.text).toContain("$5");
    expect(r.text).toContain("$9");
  });
});

// ── Streaming / partial content ──────────────────────────────────────────────

describe("streaming", () => {
  const ARTICLE =
    "Intro prose about vectors.\n\n" +
    "$$\\mathbf{c} = \\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix}$$\n\n" +
    "Then **bold** prose and inline $x^2$ math.\n\n" +
    "```python\nx = 1\n```\n\nThe end.\n";

  it("renders every prefix of a response without throwing", () => {
    for (let i = 1; i <= ARTICLE.length; i++) {
      expect(() => {
        const { unmount } = render(<MarkdownContent content={ARTICLE.slice(0, i)} />);
        unmount();
      }).not.toThrow();
    }
  });

  it("never hides already-complete leading prose behind a half-arrived delimiter", () => {
    for (let i = "Intro prose about vectors.".length; i <= ARTICLE.length; i++) {
      const r = md(ARTICLE.slice(0, i));
      expect(r.text).toContain("Intro prose about vectors.");
      cleanup();
    }
  });

  it("settles on the correct render once the full response has arrived", () => {
    const r = md(ARTICLE);
    expectNoMathErrors(r);
    expect(r.blocks).toHaveLength(1);
    expect(r.inlines).toHaveLength(1);
    expect(r.code[0]).toBe("x = 1");
    expect(r.text).toContain("The end.");
  });
});

// ── Mixed content end to end ─────────────────────────────────────────────────

describe("mixed markdown and LaTeX", () => {
  it("renders a full lesson article correctly", () => {
    const r = md(
      "# Linear Algebra\n\n" +
        "A polynomial $p(x) = 3x^2 + 2x + 1$ has a coefficient vector:\n\n" +
        "$$\\mathbf{c} = \\begin{bmatrix} 1 \\\\ 2 \\\\ 3 \\end{bmatrix}$$\n\n" +
        "## Differentiation\n\n" +
        "- the operator is **linear**\n" +
        "- it maps $\\mathbb{R}^3 \\to \\mathbb{R}^2$\n\n" +
        "$$D = \\begin{bmatrix} 0 & 1 & 0 \\\\ 0 & 0 & 2 \\end{bmatrix}$$\n\n" +
        "In code:\n\n" +
        "```python\nD = [[0, 1, 0], [0, 0, 2]]\n```\n\n" +
        "That is all.\n",
    );
    expectNoMathErrors(r);
    expect(r.blocks).toHaveLength(2);
    expect(r.container.querySelectorAll("ul li")).toHaveLength(2);
    expect(r.code[0]).toBe("D = [[0, 1, 0], [0, 0, 2]]");
    expect(r.text).toContain("That is all.");
    expect(r.text).not.toContain("\\\\");
  });
});

// ── Valid HTML nesting ───────────────────────────────────────────────────────
// A block element inside <p> is invalid, and the browser recovers by closing
// the paragraph early and splitting the article around it. React only warns,
// so this has to be asserted rather than watched for in the console.
describe("html nesting", () => {
  it("does not put a block element inside a paragraph", () => {
    const r = md("Prose before $$x = 1$$ prose after.");
    expect(r.container.querySelectorAll("p div, p pre, p h1, p h2, p h3, p h4")).toHaveLength(0);
    expect(r.blocks).toHaveLength(1);
  });

  it("does not put a block element inside a heading", () => {
    const r = md("## Title with $$x = 1$$ inside\n\nBody.\n");
    expect(r.container.querySelectorAll("h4 div")).toHaveLength(0);
  });

  it("keeps the whole paragraph together around inline display maths", () => {
    const r = md("Prose before $$x = 1$$ prose after.");
    const paragraph = r.container.querySelector("p");
    expect(paragraph?.textContent).toContain("Prose before");
    expect(paragraph?.textContent).toContain("prose after.");
  });
});

// ── Already-corrupted articles ───────────────────────────────────────────────
// Lessons written before the backend fix are still in the database with the
// environment deleted and an odd number of $$ left behind. The maths itself is
// unrecoverable, but the article around it must stay readable.
describe("legacy corrupted articles", () => {
  const CORRUPTED = [
    "The coefficient vector is:",
    "",
    "$$\\mathbf{c} = $$ 1 \\\\ 2 \\\\ 3 $$",
    "",
    "(constant term first). This vector *encodes* the polynomial completely.",
    "",
    "## Computing the Derivative",
    "",
    "The derivative $f'(x) = 6x + 2$ has coefficients $[2, 6]$.",
  ].join("\n");

  it("does not swallow the prose that follows a stray delimiter", () => {
    const r = md(CORRUPTED);
    expect(r.errors).toEqual([]);
    expect(r.container.querySelector("h4")?.textContent).toBe("Computing the Derivative");
    expect(r.text).toContain("(constant term first).");
    expect(r.container.querySelector("em")?.textContent).toBe("encodes");
  });
});

// ── Damaged content repaired at render time, on every surface ────────────────
// Articles written before the backend fix are still stored with the LaTeX
// environment deleted and an odd number of $$ left behind. MarkdownContent is
// the one component every surface renders through, so repairing here fixes
// Kojo chat, lessons, flashcards, tests, results and the rest at once.
describe("damaged maths is repaired at render time", () => {
  const DAMAGED_ARTICLE = [
    "The coefficient vector is:",
    "",
    "$$\\mathbf{c} = $$ 1 \\\\ 2 \\\\ 3 $$",
    "",
    "(constant term first). This vector *encodes* the polynomial completely.",
    "",
    "## Computing the Derivative",
    "",
    "The derivative $f'(x) = 6x + 2$ has coefficients $[2, 6]$.",
    "",
    "$$D = $$ 0 & 1 & 0 \\\\ 0 & 0 & 2 $$",
  ].join("\n");

  it("renders both matrices with no KaTeX error", () => {
    const r = md(DAMAGED_ARTICLE);
    expectNoMathErrors(r);
    expect(r.blocks).toHaveLength(2);
  });

  it("restores the environment so the rows survive", () => {
    expect(mathSourcesOf(repairMathDelimiters(DAMAGED_ARTICLE))).toEqual([
      "\\mathbf{c} = \\begin{bmatrix} 1 \\\\ 2 \\\\ 3 \\end{bmatrix}",
      "f'(x) = 6x + 2",
      "[2, 6]",
      "D = \\begin{bmatrix} 0 & 1 & 0 \\\\ 0 & 0 & 2 \\end{bmatrix}",
    ]);
  });

  it("leaves no stray delimiter or row separator in the page text", () => {
    const r = md(DAMAGED_ARTICLE);
    expect(r.text).not.toContain("$$");
    expect(r.text).not.toContain("\\\\");
  });

  it("keeps the prose, heading and emphasis intact", () => {
    const r = md(DAMAGED_ARTICLE);
    expect(r.container.querySelector("h4")?.textContent).toBe("Computing the Derivative");
    expect(r.text).toContain("(constant term first).");
    expect(r.container.querySelector("em")?.textContent).toBe("encodes");
  });

  it("changes nothing about undamaged content", () => {
    const clean =
      "# Title\n\n$$\\mathbf{c} = \\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix}$$\n\n" +
      "Prose with $x^2$ and **bold**.\n\n```bash\necho $HOME and $USER\n```\n";
    const r = md(clean);
    expectNoMathErrors(r);
    expect(r.blocks).toHaveLength(1);
    expect(r.inlines).toHaveLength(1);
    expect(r.code[0]).toBe("echo $HOME and $USER");
  });
});
