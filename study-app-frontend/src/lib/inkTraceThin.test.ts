import { describe, expect, it } from "vitest";
import { thin } from "./inkTrace";

// Zhang-Suen deletes candidates picked from one snapshot, so two touching
// pixels of a diagonal band could erase the whole line. Each pixel is now
// re-checked against the mask as it stands.
describe("thin", () => {
  it("keeps both bars of a thick X, including the exact 45 degree one", () => {
    const size = 242;
    const mask = new Uint8Array(size * size);
    const stamp = (cx: number, cy: number) => {
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= 4.5 ** 2) mask[y * size + x] = 1;
      }
    };
    const draw = (x0: number, y0: number, x1: number, y1: number) => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let s = 0; s <= n; s++) stamp(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n);
    };
    draw(40, 40, 200, 200);
    draw(200, 40, 40, 200);
    thin(mask, size, size);
    let main = 0;
    let anti = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const x = i % size;
      const y = (i - x) / size;
      if (Math.abs(x - y) < 4) main++;
      if (Math.abs(x + y - size) < 4) anti++;
    }
    expect(main).toBeGreaterThan(100);
    expect(anti).toBeGreaterThan(100);
  });
});
