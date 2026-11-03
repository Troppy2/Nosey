import { describe, expect, it } from "vitest";
import {
  canvasWindow,
  createInkFilter,
  filterInk,
  filterInkBatch,
  pageLayout,
  scrollForAnchor,
  windowNeedsMove,
  type PageLimits,
} from "./inkView";

const LIMITS: PageLimits = { baseWidth: 1000, inkScale: 0.75, maxWidth: 5000 };

// Deterministic noise, so a failure reproduces.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const rms = (values: number[]) => Math.sqrt(values.reduce((a, v) => a + v * v, 0) / values.length);

describe("pen smoothing", () => {
  it("takes most of the digitizer jitter out of a slow line", () => {
    const rand = rng(7);
    const f = createInkFilter(0, 100, 0);
    const rawNoise: number[] = [];
    const outNoise: number[] = [];
    // 30 px/s at 240 Hz, +-0.6 px of noise across the line.
    for (let i = 1; i <= 480; i++) {
      const t = (i * 1000) / 240;
      const noise = (rand() - 0.5) * 1.2;
      const [, y] = filterInk(f, (30 * t) / 1000, 100 + noise, t);
      if (i > 40) {
        rawNoise.push(noise);
        outNoise.push(y - 100);
      }
    }
    expect(rms(outNoise)).toBeLessThan(rms(rawNoise) * 0.4);
  });

  it("barely lags a fast stroke", () => {
    const f = createInkFilter(0, 0, 0);
    let x = 0;
    let fx = 0;
    // 800 px/s, steady state after a quarter second.
    for (let i = 1; i <= 60; i++) {
      const t = (i * 1000) / 240;
      x = (800 * t) / 1000;
      [fx] = filterInk(f, x, 0, t);
    }
    expect(x - fx).toBeLessThan(3);
  });

  it("treats a batch stamped with one shared time like evenly spaced samples", () => {
    const spaced = createInkFilter(0, 0, 0);
    const shared = createInkFilter(0, 0, 0);
    let a: [number, number][] = [];
    let b: [number, number][] = [];
    // 4 samples per 16 ms frame, at 200 px/s along a gentle curve.
    for (let frame = 1; frame <= 30; frame++) {
      const batch = [1, 2, 3, 4].map((k) => {
        const t = (frame - 1) * 16 + k * 4;
        return { clientX: t * 0.2, clientY: Math.sin(t / 100) * 20, timeStamp: t };
      });
      a = filterInkBatch(spaced, batch);
      b = filterInkBatch(shared, batch.map((s) => ({ ...s, timeStamp: frame * 16 })));
    }
    expect(Math.hypot(a[3][0] - b[3][0], a[3][1] - b[3][1])).toBeLessThan(0.05);
  });

  it("stays finite when samples share a timestamp", () => {
    const f = createInkFilter(0, 0, 5);
    for (let i = 0; i < 10; i++) {
      const [x, y] = filterInk(f, i, i, 5);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });
});

describe("page layout", () => {
  const at = (zoom: number, viewW: number, extra: { inkRight?: number; viewH?: number } = {}) =>
    pageLayout({ zoom, viewW, viewH: extra.viewH ?? 500, inkRight: extra.inkRight ?? 0, minHeight: 700 }, LIMITS);

  it("keeps the ink scale fixed while a wide pad is resized", () => {
    for (const viewW of [760, 801, 937.5, 1200, 1999]) expect(at(1, viewW).scale).toBe(0.75);
  });

  it("fits the base page to a narrow pad", () => {
    const layout = at(1, 600);
    expect(layout.scale).toBeCloseTo(0.6);
    expect(layout.w).toBe(1000);
    expect(layout.cssW).toBeCloseTo(600);
  });

  it("scales by exactly the zoom, with no rounding", () => {
    expect(at(2, 900).scale).toBeCloseTo(1.5, 10);
    expect(at(1.25 * 1.25, 900).scale).toBeCloseTo(0.75 * 1.5625, 10);
    expect(at(0.8, 600).scale).toBeCloseTo(0.6 * 0.8, 10);
  });

  it("zoomed out, still fills the view and holds more of the sheet", () => {
    const layout = at(0.5, 900);
    expect(layout.cssW).toBeCloseTo(900);
    expect(layout.w).toBeCloseTo(2400);
  });

  it("zoomed in, keeps the 100% page width and scrolls", () => {
    expect(at(2, 900).w).toBeCloseTo(at(1, 900).w);
  });

  it("widens the page for ink past the edge instead of shrinking the ink", () => {
    const layout = at(1, 900, { inkRight: 2000 });
    expect(layout.scale).toBe(0.75);
    expect(layout.w).toBe(2000);
  });

  it("is never shorter than the view", () => {
    expect(at(0.5, 900, { viewH: 800 }).cssH).toBeGreaterThanOrEqual(800);
  });
});

describe("zoom anchoring", () => {
  it("keeps the anchored page point under the anchor", () => {
    const layout = pageLayout({ zoom: 2, viewW: 900, viewH: 500, inkRight: 0, minHeight: 700 }, LIMITS);
    const { left, top } = scrollForAnchor(layout, 900, 500, 400, 300, 450, 250);
    expect(400 * layout.scale - left).toBeCloseTo(450);
    expect(300 * layout.scale - top).toBeCloseTo(250);
  });

  it("clamps to what the page can scroll to", () => {
    const layout = pageLayout({ zoom: 1, viewW: 900, viewH: 500, inkRight: 0, minHeight: 700 }, LIMITS);
    expect(scrollForAnchor(layout, 900, 500, 10, 10, 450, 250)).toEqual({ left: 0, top: 0 });
    const far = scrollForAnchor(layout, 900, 500, 1e6, 1e6, 0, 0);
    expect(far.left).toBeCloseTo(layout.cssW - 900);
    expect(far.top).toBeCloseTo(layout.cssH - 500);
  });
});

describe("canvas window", () => {
  const MAX = 16_000_000;

  it("covers the whole page at full density when it fits", () => {
    const layout = pageLayout({ zoom: 1, viewW: 1000, viewH: 700, inkRight: 0, minHeight: 700 }, LIMITS);
    const win = canvasWindow(layout, 1000, 700, 0, 0, 2, MAX, 256);
    expect(win.windowed).toBe(false);
    expect(win.density).toBe(2);
    expect(win.w).toBe(Math.ceil(layout.cssW));
  });

  it("covers the view at full density on a page too big for that", () => {
    const layout = pageLayout({ zoom: 3, viewW: 1000, viewH: 700, inkRight: 0, minHeight: 4200 }, LIMITS);
    const left = 1200;
    const top = 3000;
    const win = canvasWindow(layout, 1000, 700, left, top, 2, MAX, 256);
    expect(win.windowed).toBe(true);
    expect(win.density).toBe(2);
    expect(win.w * win.h * win.density ** 2).toBeLessThanOrEqual(MAX);
    expect(win.ox).toBeLessThanOrEqual(left);
    expect(win.ox + win.w).toBeGreaterThanOrEqual(left + 1000);
    expect(win.oy).toBeLessThanOrEqual(top);
    expect(win.oy + win.h).toBeGreaterThanOrEqual(top + 700);
    expect(windowNeedsMove(win, 1000, 700, left, top, 128)).toBe(false);
    expect(windowNeedsMove(win, 1000, 700, left, top + 200, 128)).toBe(true);
  });

  it("never moves a window that already reaches the page edge", () => {
    const layout = pageLayout({ zoom: 3, viewW: 1000, viewH: 700, inkRight: 0, minHeight: 4200 }, LIMITS);
    const win = canvasWindow(layout, 1000, 700, 0, 0, 2, MAX, 256);
    expect(win.ox).toBe(0);
    expect(win.oy).toBe(0);
    expect(windowNeedsMove(win, 1000, 700, 0, 0, 128)).toBe(false);
  });
});
