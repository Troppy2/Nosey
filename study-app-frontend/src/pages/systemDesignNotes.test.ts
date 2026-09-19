import { describe, expect, it } from "vitest";

import { SD_CONCEPTS } from "../data/systemDesign";
import { stripLeadingHeading } from "./SystemDesignConcept";

describe("stripLeadingHeading", () => {
  it("drops the article's own title so the page does not print it twice", () => {
    expect(stripLeadingHeading("# Caching\n\nA cache is a store.\n")).toBe("A cache is a store.\n");
  });

  it("tolerates leading whitespace before the heading", () => {
    expect(stripLeadingHeading("\n\n# Caching\n\nBody.")).toBe("Body.");
  });

  it("leaves markdown that does not open with a heading alone", () => {
    expect(stripLeadingHeading("Body first.\n\n# Later heading\n")).toBe(
      "Body first.\n\n# Later heading\n",
    );
  });

  it("does not touch a sub-heading", () => {
    expect(stripLeadingHeading("## Why a cache\n\nBody.")).toBe("## Why a cache\n\nBody.");
  });

  it("removes exactly one heading, keeping the rest of the article", () => {
    for (const concept of SD_CONCEPTS) {
      const stripped = stripLeadingHeading(concept.notes);
      expect(stripped.startsWith("# ")).toBe(false);
      expect(stripped).toContain("##");
    }
  });
});
