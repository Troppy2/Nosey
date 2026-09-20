import { describe, expect, it } from "vitest";
import { looksMangled, repairLessonMarkdown } from "./repairLessonMarkdown";

const B = "\\"; // one backslash, spelled out so the source stays readable

// The article from the bug report, as stored: every newline is the two literal
// characters backslash + n, so it renders as one blob with visible "##".
const MANGLED =
  "Measures of Spread" + B + "n" + B + "nIn statistics, knowing the center of a data set " +
  "provides a useful summary." + B + "n" + B + "n## Understanding Variability" + B + "n" + B + "n" +
  "Variability refers to the extent to which data points differ." + B + "n" + B + "n" +
  "## The Range" + B + "n" + B + "nThe simplest measure of spread is the Range." + B + "n" + B + "n";

describe("repairLessonMarkdown", () => {
  it("restores the paragraph structure of the reported article", () => {
    const fixed = repairLessonMarkdown(MANGLED);

    expect(fixed).not.toContain(B + "n");
    expect(fixed).toContain("\n\n## Understanding Variability\n\n");
    expect(fixed).toContain("\n\n## The Range\n\n");
    // Headings must start their own line, which is the whole point.
    expect(fixed.split("\n").some((line) => line.startsWith("## The Range"))).toBe(true);
  });

  it("changes no words", () => {
    const wordsOf = (s: string) => s.replace(/\\n/g, " ").split(/\s+/).filter(Boolean);
    expect(wordsOf(repairLessonMarkdown(MANGLED))).toEqual(wordsOf(MANGLED));
  });

  it("is a no-op on an article that is already clean", () => {
    const clean = "# Title\n\nSome prose.\n\n## Section\n\nMore prose with $x^2$ inline.\n";
    expect(repairLessonMarkdown(clean)).toBe(clean);
  });

  it("leaves a literal backslash-n inside a code fence alone", () => {
    // A Python string "a\nb" is real content, not damage.
    const source = "Intro" + B + "n" + B + "n```python\nprint('a" + B + "nb')\n```";
    const fixed = repairLessonMarkdown(source);
    expect(fixed).toContain("print('a" + B + "nb')");
    expect(fixed.startsWith("Intro\n\n")).toBe(true);
  });

  it("leaves a literal backslash-n inside an inline code span alone", () => {
    const source = "Use `" + B + "n` for a newline." + B + "nNext line.";
    const fixed = repairLessonMarkdown(source);
    expect(fixed).toContain("`" + B + "n`");
    expect(fixed).toContain("newline.\nNext line.");
  });

  it("does not mistake an escaped backslash for a newline", () => {
    // "\\n" is an escaped backslash followed by n, not a newline escape.
    expect(repairLessonMarkdown("a" + B + B + "nb")).toBe("a" + B + "nb");
  });

  describe("LaTeX whose backslash was eaten by a JSON control escape", () => {
    it("restores \\text from a tab", () => {
      const mangled = "$$\text{Max} - \text{Min}$$";
      expect(repairLessonMarkdown(mangled)).toBe("$$" + B + "text{Max} - " + B + "text{Min}$$");
    });

    it("restores commands behind other control characters", () => {
      expect(repairLessonMarkdown("$\frac{a}{b}$")).toBe("$" + B + "frac{a}{b}$");
      expect(repairLessonMarkdown("$\rho$")).toBe("$" + B + "rho$");
      // Block maths: the residue of an eaten \n IS a newline, and an inline
      // $...$ span is deliberately not allowed to contain one.
      expect(repairLessonMarkdown("$$\nabla f$$")).toBe("$$" + B + "nabla f$$");
    });

    it("KNOWN LIMIT: an eaten newline escape inside INLINE maths is left alone", () => {
      // Stored as "$" + newline + "abla f$". Treating that as inline maths
      // would mean letting $...$ straddle a blank line, which would swallow
      // paragraphs between two stray dollar signs and skip the newline repair
      // inside them. The blob repair matters more, so this is left to the
      // block-maths form above.
      const inlineNabla = "$\nabla f$";
      expect(repairLessonMarkdown(inlineNabla)).toBe(inlineNabla);
    });

    it("does not invent a command out of a longer word", () => {
      // TAB + "extra" must not become \text + "ra": the name has to end there.
      const source = "$\textra$";
      expect(repairLessonMarkdown(source)).toBe(source);
    });

    it("leaves correct LaTeX untouched", () => {
      const good = "$$" + B + "text{Range} = " + B + "frac{a}{b}$$";
      expect(repairLessonMarkdown(good)).toBe(good);
    });

    it("does not touch prose outside the maths", () => {
      const source = "The range is $\text{Max}$ minus the minimum." + B + "nDone.";
      const fixed = repairLessonMarkdown(source);
      expect(fixed).toContain("$" + B + "text{Max}$");
      expect(fixed).toContain("minimum.\nDone.");
    });
  });

  it("handles an empty article", () => {
    expect(repairLessonMarkdown("")).toBe("");
  });

  // The second report: backslashes stripped outright, braces left behind, so
  // KaTeX rendered "frac{sum(...)^2}{n-1}" as the italic letters f,r,a,c
  // followed by the group contents.
  describe("LaTeX whose backslash was stripped outright", () => {
    it("repairs the variance formula from the bug report", () => {
      const stored = "$$text{Variance}(s^2) = frac{sum(x_i - bar{x})^2}{n-1}$$";
      expect(repairLessonMarkdown(stored)).toBe(
        "$$" + B + "text{Variance}(s^2) = " + B + "frac{" + B + "sum(x_i - " + B + "bar{x})^2}{n-1}$$",
      );
    });

    it("repairs the other formulas in that article", () => {
      expect(repairLessonMarkdown("$$s = sqrt{s^2}$$")).toBe("$$s = " + B + "sqrt{s^2}$$");
      expect(repairLessonMarkdown("$bar{x} = frac{2+4+6}{3} = 4$")).toBe(
        "$" + B + "bar{x} = " + B + "frac{2+4+6}{3} = 4$",
      );
      expect(repairLessonMarkdown("$mu$")).toBe("$" + B + "mu$");
    });

    it("does not double a backslash that is already there", () => {
      const good = "$$" + B + "frac{" + B + "sum x}{n}$$";
      expect(repairLessonMarkdown(good)).toBe(good);
    });

    it("prefers the longest command name", () => {
      expect(repairLessonMarkdown("$textbf{A}$")).toBe("$" + B + "textbf{A}$");
    });

    it("does not touch a command name embedded in a longer word", () => {
      // "summary" must not become "\summary" or "\sum" + "mary".
      const source = "$summary$";
      expect(repairLessonMarkdown(source)).toBe(source);
    });

    it("leaves single-letter variables alone", () => {
      const source = "$a + b = c$";
      expect(repairLessonMarkdown(source)).toBe(source);
    });

    it("does not rewrite command names in prose, only in maths", () => {
      const prose = "The sum of the text is a fraction of the max.";
      expect(repairLessonMarkdown(prose)).toBe(prose);
    });
  });
});

describe("looksMangled", () => {
  it("flags the reported article", () => {
    expect(looksMangled(MANGLED)).toBe(true);
  });

  it("flags maths with a swallowed command backslash", () => {
    expect(looksMangled("$$\text{Max}$$")).toBe(true);
  });

  it("does not flag a clean article", () => {
    expect(looksMangled("# Title\n\nProse with $" + B + "text{Range}$ and a list.\n")).toBe(false);
  });

  it("does not flag a code fence that legitimately contains backslash-n", () => {
    expect(looksMangled("Intro\n\n```python\nprint('a" + B + "nb')\n```\n")).toBe(false);
  });

  it("does not flag empty content", () => {
    expect(looksMangled("")).toBe(false);
  });
});
