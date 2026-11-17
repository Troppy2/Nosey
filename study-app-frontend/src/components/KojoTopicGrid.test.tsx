import { describe, expect, it } from "vitest";
import { topicState } from "./KojoTopicGrid";

describe("topicState", () => {
  it("is not started with nothing solved", () => {
    expect(topicState(0, 5)).toBe("not-started");
  });

  it("is in progress once one problem is solved", () => {
    expect(topicState(1, 5)).toBe("in-progress");
    expect(topicState(4, 5)).toBe("in-progress");
  });

  it("is complete when every problem is solved", () => {
    expect(topicState(5, 5)).toBe("complete");
  });

  it("never calls an empty topic complete", () => {
    expect(topicState(0, 0)).toBe("not-started");
  });
});
