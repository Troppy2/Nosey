import { describe, expect, it } from "vitest";
import { easeInOut, pointAtLength, signSide, toPercent, trailLayout, walkDuration } from "./trailLayout";

describe("trail layout", () => {
  it("runs a horizontal trail left to right, alternating low and high", () => {
    const l = trailLayout(7, "horizontal");
    expect(l.points).toHaveLength(7);
    for (let i = 1; i < 7; i++) expect(l.points[i].x).toBeGreaterThan(l.points[i - 1].x);
    expect(l.points[0].y).toBeGreaterThan(l.points[1].y);
    expect(l.points[2].y).toBeGreaterThan(l.points[1].y);
    expect(l.segments).toHaveLength(6);
    expect(l.d.startsWith(`M${l.points[0].x} ${l.points[0].y}`)).toBe(true);
  });

  it("runs a vertical trail bottom to top and grows with the stop count", () => {
    const five = trailLayout(5, "vertical");
    const seven = trailLayout(7, "vertical");
    expect(seven.height).toBeGreaterThan(five.height);
    for (let i = 1; i < 7; i++) expect(seven.points[i].y).toBeLessThan(seven.points[i - 1].y);
    expect(seven.points[0].x).not.toBe(seven.points[1].x);
  });

  it("measures arc length and lands exactly on each stop", () => {
    const l = trailLayout(7, "horizontal");
    expect(l.lengths[0]).toBe(0);
    for (let i = 1; i < l.lengths.length; i++) expect(l.lengths[i]).toBeGreaterThan(l.lengths[i - 1]);
    for (let i = 0; i < 7; i++) {
      const p = pointAtLength(l, l.lengths[i]);
      expect(p.x).toBeCloseTo(l.points[i].x, 0);
      expect(p.y).toBeCloseTo(l.points[i].y, 0);
    }
    // Clamped past both ends.
    expect(pointAtLength(l, -50)).toEqual(l.points[0]);
    const end = pointAtLength(l, l.total + 50);
    expect(end.x).toBeCloseTo(l.points[6].x, 0);
  });

  it("keeps a single stop centered and walkable", () => {
    const l = trailLayout(1, "horizontal");
    expect(l.points).toHaveLength(1);
    expect(l.total).toBe(0);
    expect(pointAtLength(l, 10)).toEqual(l.points[0]);
  });

  it("puts neighboring signposts on opposite sides", () => {
    const h = trailLayout(7, "horizontal");
    const sides = h.points.map((_, i) => signSide(h, i));
    for (let i = 1; i < sides.length; i++) expect(sides[i]).not.toBe(sides[i - 1]);
    const v = trailLayout(7, "vertical");
    const vSides = v.points.map((_, i) => signSide(v, i));
    for (let i = 1; i < vSides.length; i++) expect(vSides[i]).not.toBe(vSides[i - 1]);
    expect(vSides.every((s) => s === "left" || s === "right")).toBe(true);
  });

  it("eases, times walks and converts to percent", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(walkDuration(2, 3)).toBe(1800);
    expect(walkDuration(0, 6)).toBe(3600);
    const l = trailLayout(3, "horizontal");
    expect(toPercent(l, { x: 500, y: 280 })).toEqual({ left: "50%", top: "50%" });
  });
});
