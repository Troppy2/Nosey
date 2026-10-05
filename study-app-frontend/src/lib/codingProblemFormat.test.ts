import { describe, expect, it } from "vitest";
import { formatCodingProblem } from "./codingProblemFormat";

const BLOB =
  "Problem: Implement a function `safe_div` that takes two integers, `numerator` and `denominator`. " +
  "If the denominator is 0, it should return `None` to avoid a division-by-zero error. Otherwise, it " +
  "should return the result of the integer division wrapped in `Some`. Input Format: Two integers. " +
  "Output Format: `int option`. Example 1: safe_div 10 2 returns Some 5 Example 2: safe_div 10 0 returns None";

describe("formatCodingProblem", () => {
  it("lays a run-on coding problem out in sections", () => {
    expect(formatCodingProblem(BLOB)).toBe(
      [
        "Implement a function `safe_div` that takes two integers, `numerator` and `denominator`. If the " +
          "denominator is 0, it should return `None` to avoid a division-by-zero error. Otherwise, it should " +
          "return the result of the integer division wrapped in `Some`.",
        "**Input:** Two integers.",
        "**Output:** `int option`.",
        "**Example 1**",
        "```\nsafe_div 10 2\n```",
        "Returns `Some 5`",
        "**Example 2**",
        "```\nsafe_div 10 0\n```",
        "Returns `None`",
      ].join("\n\n"),
    );
  });

  it("splits an example's own Input / Output / Explanation", () => {
    const text =
      "Return the sum of a list. Input Format: A list of ints. Output Format: An int. " +
      "Example 1: Input: [1, 2, 3] Output: 6 Explanation: 1 + 2 + 3 = 6.";
    expect(formatCodingProblem(text)).toBe(
      [
        "Return the sum of a list.",
        "**Input:** A list of ints.",
        "**Output:** An int.",
        "**Example 1**",
        "```\n[1, 2, 3]\n```",
        "Output: `6`",
        "Explanation: 1 + 2 + 3 = 6.",
      ].join("\n\n"),
    );
  });

  it("leaves structured text and ordinary prose alone", () => {
    const structured = "Sum a list.\n\n**Input:** ints\n\n**Example 1**\n\n```\nsum [1]\n```";
    expect(formatCodingProblem(structured)).toBe(structured);
    const prose = "What does this print? Output: the value of x after the loop.";
    expect(formatCodingProblem(prose)).toBe(prose);
  });
});
