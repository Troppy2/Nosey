import { describe, expect, it } from "vitest";
import { traceInk, type RawImage } from "./inkTrace";

function blank(width: number, height: number, rgb: [number, number, number] = [255, 255, 255]): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function disc(img: RawImage, cx: number, cy: number, r: number, rgb: [number, number, number]) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        const i = (y * img.width + x) * 4;
        [img.data[i], img.data[i + 1], img.data[i + 2]] = rgb;
      }
    }
  }
}

function line(img: RawImage, x0: number, y0: number, x1: number, y1: number, r: number, rgb: [number, number, number]) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) disc(img, x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, r, rgb);
}

const BLACK: [number, number, number] = [20, 20, 20];

describe("traceInk", () => {
  it("returns no strokes for a blank page", () => {
    expect(traceInk(blank(120, 80)).strokes).toEqual([]);
  });

  it("traces a thick line into one stroke along its centre", () => {
    const img = blank(200, 80);
    line(img, 20, 40, 180, 40, 2, BLACK);
    const { strokes } = traceInk(img);
    expect(strokes).toHaveLength(1);
    const xs = strokes[0].filter((_, i) => i % 2 === 0);
    const ys = strokes[0].filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeLessThan(26);
    expect(Math.max(...xs)).toBeGreaterThan(174);
    for (const y of ys) expect(Math.abs(y - 40)).toBeLessThan(2);
  });

  it("keeps a plus sign with both bars", () => {
    const img = blank(120, 120);
    line(img, 60, 20, 60, 100, 2, BLACK);
    line(img, 20, 60, 100, 60, 2, BLACK);
    const { strokes } = traceInk(img);
    expect(strokes.length).toBeGreaterThanOrEqual(1); // arms that meet are joined
    // Straight arms are two vertices, so measure to the segments, not the vertices.
    const near = (x: number, y: number) =>
      strokes.some((st) => {
        for (let i = 0; i + 3 < st.length; i += 2) {
          const [ax, ay, bx, by] = [st[i], st[i + 1], st[i + 2], st[i + 3]];
          const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
          if (Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) < 3) return true;
        }
        return false;
      });
    for (const [x, y] of [[60, 28], [60, 92], [28, 60], [92, 60]]) expect(near(x, y)).toBe(true);
  });

  it("keeps the crossbar of a small typed t", () => {
    // Screenshot-sized text: a 1px stem and a 1px crossbar 2px each side.
    // A fixed-length whisker cutoff used to delete the crossbar ("that" -> "ihai").
    const img = blank(30, 30);
    for (let y = 10; y <= 21; y++) disc(img, 10.5, y, 0.6, BLACK);
    for (let x = 8; x <= 13; x++) disc(img, x, 13, 0.6, BLACK);
    const xs = traceInk(img).strokes.flatMap((st) => st.filter((_, i) => i % 2 === 0));
    expect(Math.min(...xs)).toBeLessThan(9.5);
    expect(Math.max(...xs)).toBeGreaterThan(12);
  });

  it("ignores a yellow highlighter but keeps the pen", () => {
    const img = blank(200, 80);
    line(img, 10, 40, 190, 40, 9, [255, 247, 80]);
    line(img, 20, 40, 180, 40, 2, BLACK);
    const { strokes } = traceInk(img);
    expect(strokes).toHaveLength(1);
    const ys = strokes[0].filter((_, i) => i % 2 === 1);
    for (const y of ys) expect(Math.abs(y - 40)).toBeLessThan(2);
  });

  it("reads light writing on a dark page", () => {
    const img = blank(200, 80, [25, 25, 30]);
    line(img, 20, 40, 180, 40, 2, [235, 235, 235]);
    const { strokes } = traceInk(img);
    expect(strokes).toHaveLength(1);
  });

  it("closes a loop but does not close an open arc", () => {
    const ring = blank(120, 120);
    for (let a = 0; a < 360; a += 2) {
      disc(ring, 60 + 40 * Math.cos((a * Math.PI) / 180), 60 + 40 * Math.sin((a * Math.PI) / 180), 2, BLACK);
    }
    const loop = traceInk(ring).strokes;
    expect(loop).toHaveLength(1);
    expect(Math.hypot(loop[0][0] - loop[0][loop[0].length - 2], loop[0][1] - loop[0][loop[0].length - 1])).toBeLessThan(4);

    const arc = blank(120, 120);
    for (let a = 0; a < 200; a += 2) {
      disc(arc, 60 + 40 * Math.cos((a * Math.PI) / 180), 60 + 40 * Math.sin((a * Math.PI) / 180), 2, BLACK);
    }
    const open = traceInk(arc).strokes;
    expect(open).toHaveLength(1);
    expect(Math.hypot(open[0][0] - open[0][open[0].length - 2], open[0][1] - open[0][open[0].length - 1])).toBeGreaterThan(30);
  });
});
