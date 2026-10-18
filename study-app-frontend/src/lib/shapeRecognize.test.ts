import { describe, expect, it } from "vitest";
import { recognizeShape, type ShapeKind } from "./shapeRecognize";

const ALL: ShapeKind[] = ["line", "ellipse", "rect", "triangle", "star"];

// A slightly wobbly hand-drawn path through these corners, densely sampled.
function path(corners: [number, number][], wobble = 1.2, perEdge = 30): number[] {
  const out: number[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280 - 0.5;
  };
  for (let i = 0; i < corners.length - 1; i++) {
    const [x0, y0] = corners[i];
    const [x1, y1] = corners[i + 1];
    for (let k = 0; k < perEdge; k++) {
      const t = k / perEdge;
      out.push(x0 + (x1 - x0) * t + rand() * wobble, y0 + (y1 - y0) * t + rand() * wobble);
    }
  }
  const [lx, ly] = corners[corners.length - 1];
  out.push(lx, ly);
  return out;
}

function circle(cx: number, cy: number, rx: number, ry: number, start = 0.3): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = start + (i / 80) * Math.PI * 2 * 0.97;
    out.push(cx + rx * Math.cos(t) + Math.sin(i) * 0.8, cy + ry * Math.sin(t));
  }
  return out;
}

describe("recognizeShape", () => {
  it("snaps a near-straight stroke to a line", () => {
    const s = recognizeShape(path([[10, 10], [200, 40]]), ALL);
    expect(s?.kind).toBe("line");
    expect(s?.points).toHaveLength(4);
  });

  it("snaps a round closed stroke to a circle", () => {
    const s = recognizeShape(circle(200, 200, 80, 78), ALL);
    expect(s?.kind).toBe("ellipse");
  });

  it("snaps a box to a rectangle, even starting mid-edge", () => {
    const s = recognizeShape(path([[150, 100], [300, 100], [300, 220], [100, 220], [100, 100], [148, 100]]), ALL);
    expect(s?.kind).toBe("rect");
    expect(s?.straight).toBe(true);
  });

  it("snaps a triangle", () => {
    const s = recognizeShape(path([[100, 300], [200, 120], [300, 300], [102, 300]]), ALL);
    expect(s?.kind).toBe("triangle");
  });

  it("snaps a pentagram to a star", () => {
    const tips: [number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      tips.push([200 + 100 * Math.cos(a), 200 + 100 * Math.sin(a)]);
    }
    const s = recognizeShape(path([...tips, tips[0]]), ALL);
    expect(s?.kind).toBe("star");
  });

  it("leaves small handwriting and open squiggles alone", () => {
    expect(recognizeShape(circle(50, 50, 8, 10), ALL)).toBeNull();
    expect(recognizeShape(path([[0, 0], [60, 80], [120, 0], [180, 80]]), ALL)).toBeNull();
  });

  it("snaps a tilted ellipse", () => {
    const pts: number[] = [];
    const rot = 0.4;
    for (let i = 0; i <= 90; i++) {
      const t = (i / 90) * Math.PI * 2;
      const x = 150 * Math.cos(t);
      const y = 70 * Math.sin(t);
      pts.push(400 + x * Math.cos(rot) - y * Math.sin(rot), 400 + x * Math.sin(rot) + y * Math.cos(rot));
    }
    expect(recognizeShape(pts, ALL)?.kind).toBe("ellipse");
  });

  it("snaps an outlined ten-corner star", () => {
    const corners: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 40 : 100;
      corners.push([200 + r * Math.cos(a), 200 + r * Math.sin(a)]);
    }
    expect(recognizeShape(path([...corners, corners[0]]), ALL)?.kind).toBe("star");
  });

  it("does not snap a neatly written letter o", () => {
    expect(recognizeShape(circle(50, 50, 18, 22), ALL)).toBeNull();
  });

  it("does not turn a pentagon into a star", () => {
    const corners: [number, number][] = [];
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      corners.push([200 + 100 * Math.cos(a), 200 + 100 * Math.sin(a)]);
    }
    expect(recognizeShape(path(corners), ALL)?.kind).not.toBe("star");
  });

  it("only offers allowed shapes", () => {
    expect(recognizeShape(circle(200, 200, 80, 78), ["line"])).toBeNull();
  });
});
