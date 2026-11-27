import { describe, expect, it } from "vitest";
import { clock, readTrailRun, trailLimit } from "./trailEditor";

describe("readTrailRun", () => {
  it("reads steps and redos, ignores plain links", () => {
    expect(readTrailRun("?problem=two-sum&trailStep=7&trailPath=fixed-window")).toEqual({
      kind: "step", stepId: 7, slug: "two-sum", pathSlug: "fixed-window",
    });
    expect(readTrailRun("?problem=two-sum&trailRedos=3,x,4")).toEqual({ kind: "redo", ids: [3, 4], slug: "two-sum" });
    expect(readTrailRun("?problem=two-sum")).toBeNull();
    expect(readTrailRun("?trailStep=7")).toBeNull();
  });
  it("limits and clock", () => {
    expect(trailLimit("Easy")).toBe(900);
    expect(trailLimit("Medium")).toBe(1500);
    expect(clock(605)).toBe("10:05");
  });
});
