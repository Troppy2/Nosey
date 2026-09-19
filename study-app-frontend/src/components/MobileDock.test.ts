import { describe, expect, it } from "vitest";

import { isImmersiveRoute } from "./MobileDock";

describe("isImmersiveRoute", () => {
  it("treats the System Design workspace as immersive", () => {
    // The workspace owns the full height and its own back control, so the
    // floating dock would sit on top of the editor and the Run/Done bar.
    expect(isImmersiveRoute("/system-design/caching/visualizer")).toBe(true);
    expect(isImmersiveRoute("/system-design/consistent-hashing/project")).toBe(true);
  });

  it("leaves the reading pages on the normal shell", () => {
    expect(isImmersiveRoute("/system-design")).toBe(false);
    expect(isImmersiveRoute("/system-design/caching")).toBe(false);
  });
});
