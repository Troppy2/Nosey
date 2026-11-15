import { describe, expect, it } from "vitest";
import { isBetterTranscript, replaceSegment } from "./voice";

describe("isBetterTranscript", () => {
  it("accepts a transcript of similar length", () => {
    expect(isBetterTranscript("i would use a hash nap", "I would use a hash map.")).toBe(true);
  });

  it("accepts text when the browser heard nothing", () => {
    expect(isBetterTranscript("", "Two pointers.")).toBe(true);
  });

  it("rejects an empty transcript or one that lost most of the words", () => {
    expect(isBetterTranscript("i would use a hash map", "  ")).toBe(false);
    expect(isBetterTranscript("i would sort the array first then walk it with two pointers", "Thank you.")).toBe(false);
  });
});

describe("replaceSegment", () => {
  it("swaps only the last dictated segment", () => {
    expect(replaceSegment("typed intro hash nap", "hash nap", "hash map")).toBe("typed intro hash map");
    expect(replaceSegment("hash nap then hash nap", "hash nap", "hash map")).toBe("hash nap then hash map");
  });

  it("appends when the browser heard nothing", () => {
    expect(replaceSegment("", "", "Two pointers.")).toBe("Two pointers.");
    expect(replaceSegment("first part", "", "Two pointers.")).toBe("first part Two pointers.");
  });

  it("leaves a draft the user has edited since", () => {
    expect(replaceSegment("i fixed this myself", "hash nap", "hash map")).toBe("i fixed this myself");
  });
});
